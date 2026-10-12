// Ayudante del simulacro de restauracion (scripts/ci/backup-drill.sh).
// Usa el controlador `mongodb` que ya trae el repositorio (sin dependencias nuevas).
//
//   node backup-drill-db.mjs seed   <uri-servidor> <bd> <marcador>   siembra colecciones con datos conocidos
//   node backup-drill-db.mjs digest <uri-servidor> <bd>              imprime {coleccion: {count, sha256, indexes}}
//   node backup-drill-db.mjs drop   <uri-servidor> <bd>              borra la BD (solo nombres mockia_drill_*)
//
// La URI nunca se imprime. El marcador solo se escribe en la BD; `digest` no lo muestra.
import { createHash } from 'node:crypto';
import { EJSON, ObjectId } from 'bson';
import { MongoClient } from 'mongodb';

const [command, uri, dbName, marker] = process.argv.slice(2);

if (!command || !uri || !dbName) {
  console.error('uso: backup-drill-db.mjs seed|digest|drop <uri-servidor> <bd> [marcador]');
  process.exit(2);
}
// Red de seguridad: este ayudante solo toca bases creadas por el simulacro.
if (!/^mockia_drill_[A-Za-z0-9_]+$/.test(dbName)) {
  console.error('por seguridad solo se opera sobre bases llamadas mockia_drill_*');
  process.exit(2);
}

const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });

async function seed(db) {
  if (!marker) throw new Error('falta el marcador');
  const users = db.collection('users');
  await users.createIndex({ email: 1 }, { unique: true, name: 'email_unique' });
  await users.insertMany(
    Array.from({ length: 120 }, (_, i) => ({
      _id: new ObjectId(Buffer.from(`user${String(i).padStart(8, '0')}`).subarray(0, 12)),
      email: `${marker}-${i}@example.test`,
      name: `Usuario ${i}`,
      plan: i % 3 === 0 ? 'pro' : 'free',
      createdAt: new Date(Date.UTC(2026, 0, 1 + (i % 28))),
    }))
  );
  const projects = db.collection('projects');
  await projects.createIndex({ owner: 1, createdAt: -1 }, { name: 'owner_createdAt' });
  await projects.insertMany(
    Array.from({ length: 40 }, (_, i) => ({
      _id: new ObjectId(Buffer.from(`proj${String(i).padStart(8, '0')}`).subarray(0, 12)),
      owner: `${marker}-${i % 120}@example.test`,
      title: `Proyecto ${marker} ${i}`,
      endpoints: [
        {
          path: `/${marker}/${i}`,
          method: 'GET',
          response: { ok: true, n: i, nested: { deep: [i, i + 1] } },
        },
      ],
      createdAt: new Date(Date.UTC(2026, 1, 1 + (i % 28))),
    }))
  );
  // Una coleccion con muchos documentos pequenos (varios bloques del archivo) y una vacia.
  await db.collection('events').insertMany(
    Array.from({ length: 2500 }, (_, i) => ({
      seq: i,
      kind: i % 2 ? 'a' : 'b',
      note: `${marker}:${i}`,
    }))
  );
  await db.createCollection('empty');
}

async function digest(db) {
  const out = {};
  const collections = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith('system.'))
    .sort();
  for (const name of collections) {
    const coll = db.collection(name);
    const hash = createHash('sha256');
    let count = 0;
    for await (const doc of coll.find({}).sort({ _id: 1 })) {
      hash.update(EJSON.stringify(doc, { relaxed: false }));
      hash.update('\n');
      count += 1;
    }
    const indexes = (await coll.indexes())
      .map((i) => `${i.name}:${JSON.stringify(i.key)}:${i.unique ? 'u' : ''}`)
      .sort();
    out[name] = { count, sha256: hash.digest('hex'), indexes };
  }
  return out;
}

try {
  await client.connect();
  const db = client.db(dbName);
  if (command === 'seed') {
    await seed(db);
  } else if (command === 'digest') {
    process.stdout.write(`${JSON.stringify(await digest(db), null, 2)}\n`);
  } else if (command === 'drop') {
    await db.dropDatabase();
  } else {
    console.error(`orden desconocida: ${command}`);
    process.exitCode = 2;
  }
} catch (err) {
  // Solo el mensaje, nunca la URI ni la traza completa.
  console.error(
    `error: ${err && err.message ? String(err.message).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri>') : err}`
  );
  process.exitCode = 1;
} finally {
  await client.close().catch(() => undefined);
}
