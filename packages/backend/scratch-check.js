import mongoose from 'mongoose';
import axios from 'axios';

const MONGODB_URI = 'mongodb://root:password@localhost:27017/mockia?authSource=admin';

async function run() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB.');

    const configs = await mongoose.connection.db.collection('endpointconfigs').find({}).toArray();
    console.log('Endpoint configurations in DB:', JSON.stringify(configs, null, 2));

    const endpoints = await mongoose.connection.db.collection('endpoints').find({}).toArray();
    console.log('All endpoints in DB:', JSON.stringify(endpoints.map(e => ({ id: e._id, path: e.path, method: e.method })), null, 2));

    const projects = await mongoose.connection.db.collection('projects').find({}).toArray();
    console.log('All projects in DB:', JSON.stringify(projects.map(p => ({ id: p._id, slug: p.slug, apiKey: p.apiKey })), null, 2));

    if (configs.length > 0) {
      const config = configs.find(c => c.delay_ms > 0);
      if (config) {
        const ep = endpoints.find(e => e._id.toString() === config.endpointId.toString());
        const proj = projects.find(p => p._id.toString() === ep.mockApiId?.toString() || projects[0]); // fallback
        // find actual project for this endpoint
        const mockApi = await mongoose.connection.db.collection('mockapis').findOne({ _id: ep.mockApiId });
        const actualProj = projects.find(p => p._id.toString() === mockApi?.projectId?.toString());

        if (ep && actualProj) {
          console.log(`\nTesting HTTP request delay for: ${actualProj.slug}${ep.path} (Expect >= ${config.delay_ms}ms)`);
          const url = `http://localhost:3000/api/mock/${actualProj.slug}${ep.path}`;
          const startTime = Date.now();
          const headers = {};
          if (actualProj.apiKey) {
            headers['X-Mockia-API-Key'] = actualProj.apiKey;
          }
          const res = await axios.get(url, { headers });
          const duration = Date.now() - startTime;
          console.log(`Response received in ${duration}ms! Status: ${res.status}`);
        }
      }
    }

  } catch (err) {
    console.error('Error:', err);
  } finally {
    await mongoose.disconnect();
  }
}

run();
