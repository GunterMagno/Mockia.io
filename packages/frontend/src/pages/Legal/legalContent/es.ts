import type { LegalContent } from './types'

/**
 * Textos legales en español (idioma principal).
 * BORRADOR: redactado a partir de lo que el producto hace realmente (verificado en el codigo). Debe revisarlo un abogado
 * antes de publicarse. Si el producto cambia (nuevo proveedor, nuevos datos, nuevas cookies), actualizar aqui y en en.ts/zh.ts,
 * y cambiar LEGAL_LAST_UPDATED en ../legalConfig.ts.
 */
const es: LegalContent = {
  updatedLabel: 'Última actualización',
  draftNotice:
    'Borrador pendiente de revisión jurídica. Estos textos describen el funcionamiento real del servicio, pero aún no los ha validado un profesional del derecho.',
  placeholders: {
    name: '[Nombre del titular — pendiente]',
    nif: '[NIF del titular — pendiente]',
    address: '[Domicilio del titular — pendiente]',
    email: '[Email de contacto — pendiente]',
  },
  otherDocuments: 'Otros documentos legales',
  docs: {
    // ---------------------------------------------------------------------------------------------------------
    legal: {
      title: 'Aviso Legal',
      sections: [
        {
          heading: 'Datos identificativos del titular',
          blocks: [
            {
              p: 'En cumplimiento del artículo 10 de la Ley 34/2002, de Servicios de la Sociedad de la Información y de Comercio Electrónico (LSSI-CE), se informa de que el sitio web Mockia.io (en adelante, el «Sitio» o el «Servicio») es titularidad de:',
            },
            {
              ul: [
                '**Titular:** {entity.name}',
                '**NIF:** {entity.nif}',
                '**Domicilio:** {entity.address}',
                '**Email de contacto:** [{entity.email}](mailto:{entity.email})',
                '**Datos registrales:** {entity.registry}',
              ],
            },
          ],
        },
        {
          heading: 'Objeto y actividad',
          blocks: [
            {
              p: 'Mockia.io es un servicio en línea que genera y aloja APIs simuladas («mock») a partir de repositorios públicos de GitHub y de las instrucciones que escribe el usuario, con ayuda de inteligencia artificial. Ofrece un plan gratuito y planes de pago por suscripción; sus condiciones están en los [Términos del Servicio](/terms).',
            },
          ],
        },
        {
          heading: 'Condiciones de uso del Sitio',
          blocks: [
            {
              p: 'La navegación por las páginas públicas del Sitio es gratuita. El uso del Servicio con una cuenta se rige por los [Términos del Servicio](/terms). El usuario se compromete a utilizar el Sitio conforme a la ley, a la buena fe y al orden público, y a no emplearlo para fines ilícitos ni lesivos de derechos de terceros.',
            },
          ],
        },
        {
          heading: 'Propiedad intelectual e industrial',
          blocks: [
            {
              p: 'El código, el diseño, los textos, los logotipos y demás elementos del Sitio son titularidad de {entity.name} o de sus licenciantes y están protegidos por la normativa de propiedad intelectual e industrial. No se permite su reproducción, distribución o transformación sin autorización, salvo lo que la ley permita expresamente.',
            },
            {
              p: 'Los contenidos que el usuario aporta y los resultados generados para él se tratan en los [Términos del Servicio](/terms).',
            },
          ],
        },
        {
          heading: 'Responsabilidad',
          blocks: [
            {
              p: 'El titular procura que la información y el funcionamiento del Sitio sean correctos, pero no garantiza su disponibilidad ininterrumpida ni la ausencia de errores. El contenido generado con inteligencia artificial puede ser inexacto. El titular no responde de los daños derivados de un uso indebido del Sitio ni, en la medida que la ley permita, de interrupciones por mantenimiento, fallos de terceros o causas de fuerza mayor. Lo anterior no limita los derechos irrenunciables de los consumidores.',
            },
          ],
        },
        {
          heading: 'Enlaces a terceros',
          blocks: [
            {
              p: 'El Sitio puede enlazar a páginas de terceros (por ejemplo, GitHub o Stripe). El titular no controla esos sitios y no responde de su contenido ni de sus políticas. Si tienes conocimiento de un contenido ilícito enlazado desde el Sitio, comunícalo a [{entity.email}](mailto:{entity.email}).',
            },
          ],
        },
        {
          heading: 'Protección de datos y cookies',
          blocks: [
            {
              p: 'El tratamiento de datos personales se explica en la [Política de Privacidad](/privacy) y el uso de cookies y almacenamiento local en la [Política de Cookies](/cookies).',
            },
          ],
        },
        {
          heading: 'Legislación aplicable y jurisdicción',
          blocks: [
            {
              p: 'Este Aviso Legal se rige por la legislación española. Para cualquier controversia, las partes se someten a los juzgados y tribunales que resulten competentes conforme a la normativa aplicable; cuando el usuario sea consumidor, serán los de su domicilio si así lo establece la ley.',
            },
          ],
        },
      ],
    },

    // ---------------------------------------------------------------------------------------------------------
    privacy: {
      title: 'Política de Privacidad',
      sections: [
        {
          heading: 'Quién es el responsable',
          blocks: [
            {
              p: 'Esta política explica qué datos personales trata Mockia.io, para qué, con qué base jurídica, quién más los recibe y qué derechos tienes, conforme al Reglamento (UE) 2016/679 (RGPD) y a la Ley Orgánica 3/2018 (LOPDGDD). El responsable del tratamiento es:',
            },
            {
              ul: [
                '**Responsable:** {entity.name}',
                '**NIF:** {entity.nif}',
                '**Domicilio:** {entity.address}',
                '**Contacto para cuestiones de privacidad y para ejercer tus derechos:** [{entity.email}](mailto:{entity.email})',
              ],
            },
          ],
        },
        {
          heading: 'Qué datos tratamos y de dónde proceden',
          blocks: [
            { p: 'Solo tratamos los datos que el Servicio necesita para funcionar. Estos son todos los que guardamos:' },
            {
              table: {
                head: ['Categoría', 'Datos', 'Origen'],
                rows: [
                  [
                    '**Cuenta**',
                    'Email, nombre de usuario, contraseña (guardada únicamente como hash bcrypt, nunca en claro) e idioma preferido de la interfaz.',
                    'Tú, al registrarte y al elegir idioma.',
                  ],
                  [
                    '**Sesión y seguridad**',
                    'Sesiones activas (identificador, fecha de creación y de caducidad, dirección IP y navegador o «user-agent»), cookie de sesión `mockia_rt`, y enlaces de un solo uso para verificar el email o restablecer la contraseña (solo se guarda su huella, no el enlace). Registros de acceso del servidor (IP, fecha, ruta solicitada, navegador).',
                    'Tu navegador, automáticamente.',
                  ],
                  [
                    '**Proyectos y contenido**',
                    'Nombre y descripción de tus proyectos, URL del repositorio público de GitHub, resumen estructurado extraído de ese repositorio (nombres de tipos, interfaces, funciones, rutas y documentación principal), los endpoints, respuestas y datos de ejemplo que se generan, y las instrucciones que escribes.',
                    'Tú, y el repositorio público que indicas.',
                  ],
                  [
                    '**Facturación**',
                    'Plan contratado, estado de la suscripción, fecha de fin del periodo e identificadores de cliente y de suscripción en Stripe. Los datos de pago y de facturación que introduces en el pago (tarjeta, nombre, dirección, identificación fiscal si la indicas) los recoge Stripe: Mockia.io nunca ve ni guarda el número de tu tarjeta.',
                    'Tú y Stripe.',
                  ],
                  [
                    '**Uso**',
                    'Contador mensual de peticiones recibidas por tus APIs simuladas (solo el número, para aplicar los límites del plan) y notificaciones dentro de la aplicación.',
                    'El propio Servicio.',
                  ],
                  [
                    '**Mejora de la IA (opcional)**',
                    'Solo si lo activas tú: las instrucciones tal como se envían al modelo (que pueden incluir fragmentos del resumen y de la documentación de tu repositorio y lo que escribes), la respuesta del modelo, las correcciones que hagas, y el momento en que diste o retiraste el consentimiento.',
                    'Tú, con tu consentimiento, y el Servicio.',
                  ],
                  [
                    '**Demo pública (sin cuenta)**',
                    'El texto que pegas o la plantilla que eliges (se envía al proveedor de IA y no se guarda), un seudónimo de tu dirección IP (HMAC-SHA256 con una sal que cambia cada día; nunca la dirección en sí), contadores diarios de uso y la API simulada que se genera, que dura 30 minutos. Además, los registros de acceso del servidor (véase «Demo pública sin registro»).',
                    'Tú y tu navegador.',
                  ],
                  [
                    '**Comunicaciones**',
                    'Los mensajes que nos envíes y los correos transaccionales que te enviamos (verificación, recuperación de contraseña, avisos de pago).',
                    'Tú y el Servicio.',
                  ],
                ],
              },
            },
            {
              p: 'No tratamos categorías especiales de datos ni te pedimos que las incluyas. Te rogamos que no incluyas datos personales de terceros ni secretos (claves, contraseñas) en tus instrucciones o en los repositorios que conectes.',
            },
          ],
        },
        {
          heading: 'Para qué y con qué base jurídica',
          blocks: [
            {
              table: {
                head: ['Finalidad', 'Base jurídica (art. 6 RGPD)'],
                rows: [
                  [
                    'Crear y gestionar tu cuenta, identificarte, enviarte el correo de verificación y de recuperación de contraseña, y prestarte el Servicio (generar, alojar y servir tus APIs simuladas).',
                    'Ejecución del contrato (art. 6.1.b): los Términos del Servicio.',
                  ],
                  [
                    'Cobrar las suscripciones, emitir facturas, avisarte de pagos fallidos y cumplir las obligaciones contables y fiscales.',
                    'Ejecución del contrato (art. 6.1.b) y obligación legal (art. 6.1.c).',
                  ],
                  [
                    'Mantener la seguridad del Servicio: limitar intentos de acceso, detectar abusos y fraude, revocar sesiones comprometidas y conservar registros de acceso.',
                    'Interés legítimo (art. 6.1.f) en la seguridad de la red y de la información y en la prevención del abuso, que no prevalece sobre tus derechos al limitarse a lo imprescindible.',
                  ],
                  [
                    'Recordar tu idioma y otras preferencias de la interfaz.',
                    'Ejecución del contrato (art. 6.1.b). Es almacenamiento técnico necesario que solicitas expresamente (véase la [Política de Cookies](/cookies)).',
                  ],
                  [
                    'Mejorar el modelo de IA de Mockia: guardar, solo si lo activas, tus generaciones y correcciones para evaluar el modelo y, si hace falta, entrenar uno propio (véase «Mejorar la IA con tus generaciones»).',
                    'Consentimiento (art. 6.1.a), opcional y revocable en cualquier momento.',
                  ],
                  [
                    'Ofrecer una demo sin registro y evitar abusos de la demo (límites diarios por visitante y totales, tope de generaciones simultáneas), véase «Demo pública sin registro».',
                    'Interés legítimo (art. 6.1.f): ofrecer la demo y proteger el Servicio y su presupuesto frente al abuso. Se pondera que la base de datos de la demo solo guarda datos seudonimizados y de vida corta, que la IP y la dirección solicitada solo figuran en claro en los registros de acceso generales del servidor y del alojamiento, y que la demo funciona sin cuenta, sin perfilado ni cookies.',
                  ],
                  [
                    'Atender tus consultas y el ejercicio de tus derechos, y defender reclamaciones.',
                    'Obligación legal (art. 6.1.c) e interés legítimo (art. 6.1.f).',
                  ],
                ],
              },
            },
            {
              p: 'El único tratamiento que se basa en tu consentimiento es la mejora de la IA con tus generaciones (véase «Mejorar la IA con tus generaciones»): es opcional, está desactivado por defecto y puedes retirarlo en cualquier momento sin que cambie tu uso del Servicio. No enviamos comunicaciones comerciales. Si en el futuro añadimos otros tratamientos basados en el consentimiento (por ejemplo, analítica o publicidad), te lo pediremos antes y podrás retirarlo en cualquier momento.',
            },
            {
              p: 'Facilitar los datos de la cuenta es necesario para contratar el Servicio: sin ellos no podemos crearla.',
            },
          ],
        },
        {
          heading: 'Repositorios de GitHub: qué hacemos y qué no',
          blocks: [
            {
              p: 'Mockia.io no usa inicio de sesión con GitHub y **no guarda ningún token ni credencial de GitHub**. Solo funciona con repositorios públicos: cuando creas o actualizas un proyecto, nuestro servidor descarga temporalmente el repositorio a partir de su URL pública, extrae la estructura necesaria (tipos, interfaces, funciones, rutas y la documentación principal) y elimina la copia descargada. Conservamos únicamente ese resumen estructurado, que se borra automáticamente a los 30 días de crearse.',
            },
          ],
        },
        {
          heading: 'Inteligencia artificial',
          blocks: [
            {
              p: 'Para generar los endpoints, enviamos a un proveedor de modelos de IA (actualmente OpenRouter, que encamina la petición a un modelo de terceros) el resumen estructurado del repositorio, la documentación principal que contiene, las instrucciones que escribes, el título y la descripción del proyecto, y la URL del repositorio y su propietario (el nombre de la cuenta u organización de GitHub). No enviamos tu email, tu contraseña ni tus datos de facturación. El proveedor aplica sus propias condiciones de uso de los datos; consulta su política de privacidad.',
            },
            {
              p: 'En el futuro podremos ofrecer también un modelo alojado en nuestra propia infraestructura, en cuyo caso esos datos no saldrían de ella; actualizaremos esta política cuando ocurra.',
            },
            {
              p: 'En la demo pública sin registro solo enviamos el texto que pegas (o una plantilla propia) y nuestras instrucciones fijas; véase «Demo pública sin registro».',
            },
            {
              p: 'No tomamos decisiones basadas únicamente en tratamientos automatizados, incluida la elaboración de perfiles, que produzcan efectos jurídicos sobre ti o te afecten significativamente de modo similar (art. 22 RGPD). La IA se usa para generar borradores de APIs simuladas, no para evaluarte. La aplicación automática de los límites de tu plan, o el paso al plan gratuito por un pago fallido, es una consecuencia contractual objetiva que puedes impugnar escribiéndonos.',
            },
          ],
        },
        {
          id: 'ai-training',
          heading: 'Mejorar la IA con tus generaciones (opcional)',
          blocks: [
            {
              p: 'Con tu **consentimiento expreso** (art. 6.1.a RGPD) puedes ayudarnos a **mejorar el modelo de IA de Mockia**. Es totalmente opcional, está desactivado por defecto y es independiente del uso del Servicio: no cambia tu plan, tus límites ni lo que recibes, y puedes usar Mockia.io exactamente igual sin activarlo.',
            },
            {
              ul: [
                '**Qué guardamos si lo activas:** las instrucciones tal como se envían al modelo (que pueden incluir fragmentos del resumen y de la documentación de tu repositorio y lo que tú escribes), la respuesta del modelo, las correcciones que hagas a un resultado y el proveedor y modelo que respondieron. Si no lo activas, no guardamos nada de este contenido.',
                '**Para qué:** preparar conjuntos de ejemplos para evaluar el modelo y, si hace falta, ajustar (entrenar) un modelo propio de Mockia.io que genere mejores APIs simuladas. No lo usamos para publicidad ni para perfilarte, y no lo vendemos.',
                '**Cómo se usan:** antes de preparar un conjunto de ejemplos se eliminan de forma automática las claves, tokens, contraseñas y cadenas de conexión, las direcciones de correo, y el nombre del repositorio, su propietario, su URL, su rama y el nombre y la descripción del proyecto; y se descartan los duplicados exactos. El conjunto resultante **no contiene tu email, tu identificador de usuario ni el identificador de la generación**, y solo incluye ejemplos de usuarios cuyo consentimiento sigue vigente en ese momento. **No se detectan** los nombres de personas, teléfonos, direcciones IP u otros datos personales que se hayan escrito dentro del texto del README o de tus propias instrucciones, ni los secretos sin forma reconocible: el filtrado es automático y heurístico, no infalible.',
                '**Cuánto tiempo:** 180 días desde cada generación, o hasta que retires el consentimiento o elimines tu cuenta, lo que ocurra antes.',
                '**Cómo retirarlo:** en cualquier momento, en tu perfil → «Mis datos». Al retirarlo borramos de inmediato todo lo guardado (generaciones y valoraciones). Retirarlo no afecta a la licitud del tratamiento anterior.',
                '**Una limitación que debes conocer:** si con ejemplos tuyos ya se ha entrenado un modelo, retirar el consentimiento no puede «desentrenarlo». Lo que garantizamos es que tus datos no se usarán en entrenamientos futuros: cada conjunto de ejemplos se prepara de nuevo a partir de los datos vigentes en ese momento.',
              ],
            },
            {
              p: 'Si lo activas, evita incluir secretos o datos personales de terceros en tus instrucciones y repositorios: aplicamos filtros automáticos, pero no son infalibles. Puedes descargar lo guardado desde perfil → «Mis datos» → «Descargar mis datos».',
            },
            {
              p: 'El voto «útil / no útil» que das a un resultado solo se guarda si has activado esta opción; si no la has activado, el voto no se almacena en ningún caso.',
            },
          ],
        },
        {
          id: 'demo',
          heading: 'Demo pública sin registro',
          blocks: [
            {
              p: 'La demo pública permite probar el generador de IA sin crear una cuenta. **Finalidad:** ofrecer una demo sin registro y evitar abusos (la demo consume un modelo de IA de pago, por eso tiene límites). **Base jurídica:** interés legítimo (art. 6.1.f) del RGPD en ofrecer la demo y protegerla frente al abuso, cuya ponderación tiene en cuenta tres cosas: que la base de datos de la demo solo guarda datos seudonimizados y de vida corta; que la IP y la dirección solicitada sí figuran en claro en los registros de acceso generales del servidor y del alojamiento, con el plazo que se indica más abajo; y que la demo funciona sin cuenta, sin perfilado ni cookies. Esto es todo lo que ocurre con tus datos en la demo:',
            },
            {
              ul: [
                '**Lo que envías:** el texto que pegas (hasta 6 000 caracteres) o la plantilla que eliges. No guardamos ese texto: ni en la base de datos ni en los registros de la aplicación. Sí se envía al proveedor de IA configurado para la demo, que lo recibe para generar el resultado: OpenRouter (que lo encamina a un modelo de terceros) o, si así lo hemos configurado, un modelo alojado en nuestra propia infraestructura, en cuyo caso el texto no sale de ella. El proveedor recibe además nuestras instrucciones fijas, pero nunca tu dirección IP (la petición sale de nuestro servidor). Por favor, no pegues datos personales de terceros ni secretos.',
                '**Tu dirección IP, seudonimizada:** para aplicar los límites diarios, la base de datos de la demo nunca guarda tu dirección IP en claro: guarda solo un seudónimo calculado con HMAC-SHA256, con una clave secreta y una sal que cambia cada día UTC (en IPv6 la dirección se reduce antes a su prefijo /64 y, para el contador de red, se guarda además un segundo seudónimo calculado igual a partir de su prefijo /48). Sin la clave no se puede revertir y es distinto cada día, así que el seudónimo por sí solo no permite seguirte de un día a otro (los registros de acceso del servidor, en cambio, contienen la dirección IP en claro; véase más abajo). El seudónimo se guarda en los contadores diarios y en el registro de la API simulada que generas.',
                '**Contadores:** los contadores diarios (por seudónimo y global) caducan automáticamente: cada uno se borra, como mínimo, 48 horas después de terminar el día al que corresponde (la base de datos puede tardar hasta un minuto más en borrarlo). Los identificadores de los retos anti-bots ya usados son aleatorios, no tienen relación contigo y se borran a los 10 minutos. Los límites de ráfaga viven solo en la memoria del servidor y no se guardan en la base de datos.',
                '**Lo que obtienes:** la API simulada que se genera (endpoints y respuestas de ejemplo) dura 30 minutos y después se borra automáticamente (la limpieza de la base de datos puede tardar hasta aproximadamente un minuto más). Mientras dura, cualquiera que tenga su dirección web, que es larga y aleatoria, puede llamarla. Esa API puede reproducir fragmentos de lo que pegas (nombres, campos o valores que aparezcan en tu texto), de modo que, aunque no guardemos tu texto, parte de su contenido puede quedar en el resultado durante esos 30 minutos: no pegues datos personales, secretos ni credenciales.',
                '**Registros de acceso del servidor:** como en el resto del Servicio, el servidor registra en sus registros de acceso la dirección IP en claro, la fecha, la dirección solicitada (que, en la API simulada, incluye su identificador aleatorio), el código de respuesta y el navegador. Estos registros no incluyen el texto que pegas ni la respuesta del modelo, y no forman parte de la base de datos de la demo. El proxy inverso o la plataforma de alojamiento pueden llevar además sus propios registros. Su plazo de conservación depende del proveedor de alojamiento: [[REVISAR: retención de logs del hosting]].',
                '**Sin cookies ni almacenamiento local, salvo si decides guardar el proyecto:** la demo no usa cookies ni almacenamiento local de tu navegador (véase la [Política de Cookies](/cookies)). Solo si decides guardar el proyecto, pulsando el botón para crear tu cuenta desde el resultado de la demo, el identificador de tu demo se guarda en el almacenamiento de sesión de esta pestaña (sessionStorage) hasta que lo reclames o la cierres; es estrictamente necesario para esa función, no se usa para nada más y se borra al reclamarlo, al caducar la demo o al cerrar la pestaña. Al reclamarla, la API simulada se copia como un proyecto de tu cuenta, que pasa a regirse por el resto de esta Política, y la demo temporal se elimina. La comprobación anti-bot se calcula en tu navegador y no se guarda, y no cargamos ningún servicio de terceros para ello.',
                '**Tus derechos:** puedes ejercerlos escribiendo a [{entity.email}](mailto:{entity.email}), en especial el derecho de oposición (art. 21 RGPD) a este tratamiento. Como solo guardamos un seudónimo que cambia cada día y no sabemos quién hay detrás, para localizar tus datos tendrías que indicarnos la dirección IP que usaste y el día, y calcularíamos el seudónimo (art. 11 RGPD); en cualquier caso los datos desaparecen solos en los plazos indicados.',
              ],
            },
          ],
        },
        {
          heading: 'Quién más recibe tus datos',
          blocks: [
            {
              p: 'No vendemos tus datos. Los comunicamos solo a proveedores que nos prestan servicios y que actúan como encargados del tratamiento bajo contrato, y a las autoridades cuando la ley lo exige:',
            },
            {
              table: {
                head: ['Proveedor', 'Para qué', 'Qué datos recibe'],
                rows: [
                  [
                    '**Stripe** (Stripe Payments Europe, Ltd. y Stripe, Inc.)',
                    'Procesar los pagos y la facturación de las suscripciones, y alojar el portal del cliente. Stripe también trata datos como responsable propio para prevenir el fraude y cumplir la normativa financiera ([política de privacidad de Stripe](https://stripe.com/privacy)).',
                    'Email, datos de facturación y de pago que introduces, importes y estado de la suscripción. Mockia.io no recibe el número de tu tarjeta.',
                  ],
                  [
                    '**Proveedor de IA** (actualmente OpenRouter y los modelos a los que encamina)',
                    'Generar los endpoints y datos de ejemplo.',
                    'Resumen estructurado del repositorio público, documentación principal, instrucciones que escribes, título y descripción del proyecto, y URL del repositorio y su propietario. En la demo pública: solo el texto que pegas (o una plantilla) y nuestras instrucciones fijas. Nunca tu email, contraseña ni datos de pago.',
                  ],
                  [
                    '**Proveedor de correo transaccional** (servicio SMTP contratado)',
                    'Enviar los correos de verificación, recuperación de contraseña y avisos de pago.',
                    'Tu email y el contenido del mensaje, que incluye un enlace de un solo uso.',
                  ],
                  [
                    '**Proveedor de alojamiento** (Render u otra infraestructura en la nube o servidor propio)',
                    'Alojar la aplicación, la base de datos y los registros del servidor.',
                    'Todos los datos descritos arriba, como infraestructura.',
                  ],
                ],
              },
            },
            {
              p: 'GitHub recibe de nuestro servidor la petición de descarga de los repositorios públicos que indicas (con la IP del servidor, no la tuya).',
            },
          ],
        },
        {
          heading: 'Transferencias internacionales',
          blocks: [
            {
              p: 'Algunos de estos proveedores (Stripe, el proveedor de IA y el de alojamiento) pueden tratar datos fuera del Espacio Económico Europeo, en particular en Estados Unidos. En esos casos la transferencia se ampara en la decisión de adecuación de la Comisión Europea para el Marco de Privacidad de Datos UE-EE. UU. cuando el proveedor está adherido a él y, en su defecto, en las cláusulas contractuales tipo de la Comisión (art. 46.2.c RGPD). Puedes pedirnos más información en [{entity.email}](mailto:{entity.email}).',
            },
          ],
        },
        {
          heading: 'Cuánto tiempo conservamos los datos',
          blocks: [
            {
              table: {
                head: ['Datos', 'Plazo'],
                rows: [
                  [
                    'Cuenta, proyectos y contenido',
                    'Mientras mantengas la cuenta. Si la eliminas o nos pides la supresión, los borramos, salvo lo indicado más abajo.',
                  ],
                  ['Proyectos archivados', 'Se eliminan definitivamente 30 días después de archivarlos.'],
                  [
                    'Generaciones guardadas para mejorar la IA y valoraciones (solo con tu consentimiento)',
                    '180 días, o hasta que retires el consentimiento o elimines la cuenta; al retirarlo se borran de inmediato.',
                  ],
                  [
                    'Resumen estructurado de un repositorio',
                    '30 días desde que se crea; después se borra automáticamente.',
                  ],
                  [
                    'Sesiones (incluidas IP y navegador)',
                    'Hasta 7 días; caducan y se borran automáticamente. También se revocan al cerrar sesión o restablecer la contraseña.',
                  ],
                  [
                    'Enlaces de verificación de email y de recuperación de contraseña',
                    '24 horas y 30 minutos, respectivamente; después se borran automáticamente.',
                  ],
                  [
                    'Datos de facturación y fiscales',
                    'Durante los plazos legales aplicables (obligaciones mercantiles y tributarias), debidamente bloqueados.',
                  ],
                  [
                    'Demo pública: el texto que pegas',
                    'No se guarda; solo se envía al proveedor de IA para generar el resultado.',
                  ],
                  [
                    'Demo pública: contadores diarios con el seudónimo de la IP',
                    'Se borran automáticamente, como mínimo, 48 horas después de terminar el día al que corresponden.',
                  ],
                  [
                    'Demo pública: la API simulada generada y su contenido',
                    '30 minutos; después se borra automáticamente. Puede reproducir fragmentos de lo que pegas, y cualquiera que tenga su dirección web puede consultarla mientras dura.',
                  ],
                  [
                    'Registros de acceso del servidor (incluyen la dirección IP en claro)',
                    'Durante el periodo limitado que aplique el proveedor de alojamiento y el necesario para la seguridad. [[REVISAR: retención de logs del hosting]]',
                  ],
                  [
                    'Consultas y comunicaciones contigo',
                    'El tiempo necesario para atenderlas y, después, durante los plazos de prescripción de posibles responsabilidades.',
                  ],
                ],
              },
            },
          ],
        },
        {
          heading: 'Tus derechos',
          blocks: [
            {
              p: 'Puedes ejercer en cualquier momento los derechos de acceso, rectificación, supresión, limitación del tratamiento, portabilidad y oposición, así como retirar tu consentimiento cuando un tratamiento se base en él. Para ejercerlos escribe a [{entity.email}](mailto:{entity.email}) indicando el derecho que quieres ejercer; podemos pedirte que acredites tu identidad. Respondemos en el plazo de un mes (ampliable en dos meses más en casos complejos, avisándote) y es gratuito, salvo solicitudes manifiestamente infundadas o excesivas.',
            },
            {
              p: 'Parte de ello puedes hacerlo tú mismo desde la aplicación: cambiar tu idioma, cerrar sesión, restablecer tu contraseña, descargar una copia de tus datos, eliminar tu cuenta y activar o retirar el consentimiento para mejorar la IA (perfil → «Mis datos»).',
            },
            {
              p: 'Si consideras que tus datos no se tratan correctamente, tienes derecho a presentar una reclamación ante la Agencia Española de Protección de Datos (AEPD): [www.aepd.es](https://www.aepd.es).',
            },
          ],
        },
        {
          heading: 'Seguridad',
          blocks: [
            {
              p: 'Aplicamos medidas técnicas y organizativas acordes con el riesgo. Entre ellas: las contraseñas se guardan solo como hash bcrypt; los enlaces de verificación y recuperación son de un solo uso y se almacenan únicamente como huella; la cookie de sesión es HttpOnly y no puede leerla el código de la página; el Servicio se sirve por HTTPS en producción; limitamos los intentos de acceso; y los datos de pago no pasan por nuestros servidores. Ningún sistema es infalible: si ocurriera una brecha que afecte a tus datos, la comunicaremos a ti y a la autoridad cuando la ley lo exija.',
            },
          ],
        },
        {
          heading: 'Edad mínima',
          blocks: [
            {
              p: 'Para usar Mockia.io debes tener al menos 14 años (art. 7 LOPDGDD). Si descubrimos que una cuenta pertenece a una persona menor de esa edad, la eliminaremos.',
            },
          ],
        },
        {
          heading: 'Cambios en esta política',
          blocks: [
            {
              p: 'Podemos actualizar esta política, por ejemplo si cambiamos de proveedor o añadimos tratamientos. Publicaremos la nueva versión con su fecha de actualización y, si el cambio es relevante, te lo comunicaremos por email o en la aplicación.',
            },
          ],
        },
      ],
    },

    // ---------------------------------------------------------------------------------------------------------
    terms: {
      title: 'Términos del Servicio',
      sections: [
        {
          heading: 'Quiénes somos y aceptación',
          blocks: [
            {
              p: 'Estos Términos regulan el uso de Mockia.io, un servicio de {entity.name} (NIF {entity.nif}), cuyos datos completos figuran en el [Aviso Legal](/legal). Al crear una cuenta o usar el Servicio aceptas estos Términos y la [Política de Privacidad](/privacy). Si no estás de acuerdo, no uses el Servicio.',
            },
            {
              p: 'Debes tener al menos 14 años para usar el Servicio y ser mayor de edad para contratar un plan de pago.',
            },
          ],
        },
        {
          heading: 'El Servicio',
          blocks: [
            {
              p: 'Mockia.io genera, aloja y sirve APIs simuladas («mock») para desarrollo y pruebas a partir de repositorios públicos de GitHub y de tus instrucciones, con ayuda de inteligencia artificial. No es un entorno de producción: no debes usarlo para servir datos reales ni como base de un servicio crítico.',
            },
          ],
        },
        {
          heading: 'Tu cuenta',
          blocks: [
            {
              p: 'Eres responsable de que los datos de tu cuenta sean veraces, de mantener en secreto tu contraseña y de lo que ocurra desde tu cuenta. Avísanos de inmediato si sospechas un acceso no autorizado. Para usar la generación con IA y la facturación puede ser necesario verificar tu email.',
            },
          ],
        },
        {
          heading: 'Planes y precios',
          blocks: [
            {
              p: 'Ofrecemos los planes Free, Starter, Pro y Team. Los precios vigentes, los límites de cada plan (proyectos activos, peticiones mensuales y generaciones de IA al mes) y, cuando esté disponible, la modalidad de pago anual se muestran en la [sección de precios](/) de la página principal y son los que se aplican a tu contratación en el momento de hacerla. El plan Free es gratuito y puede cambiar o retirarse con aviso.',
            },
            {
              p: 'Los precios se indican sin impuestos cuando proceda. El IVA u otros impuestos aplicables se calculan según tu país y se muestran en el proceso de pago antes de que confirmes.',
            },
          ],
        },
        {
          heading: 'Pago y renovación automática',
          blocks: [
            {
              p: 'Los planes de pago son suscripciones mensuales (y anuales, cuando se ofrezcan) que se **renuevan automáticamente** por periodos iguales hasta que las canceles. Cobramos al inicio de cada periodo en el método de pago que indiques. Los pagos los procesa Stripe; Mockia.io no recibe ni guarda los datos de tu tarjeta. Recibirás la factura y podrás gestionar tu método de pago desde el portal del cliente.',
            },
            {
              p: 'Si cambiamos el precio de un plan, te avisaremos con antelación razonable y antes de la siguiente renovación; si no lo aceptas, podrás cancelar antes de que se aplique.',
            },
          ],
        },
        {
          heading: 'Cancelación',
          blocks: [
            {
              p: 'Puedes cancelar en cualquier momento desde el portal del cliente, al que accedes desde la página de Facturación de tu cuenta. La cancelación tiene efecto al final del periodo ya pagado: hasta entonces conservas el plan y después pasas al plan Free, con sus límites. No eliminamos tus proyectos por cambiar de plan.',
            },
            {
              p: 'No reembolsamos de forma proporcional el periodo en curso al cancelar, salvo que la ley lo exija.',
            },
          ],
        },
        {
          heading: 'Impago',
          blocks: [
            {
              p: 'Si un cobro falla, la suscripción pasa al estado de pago pendiente (past_due), te lo avisamos por email y en la aplicación, y Stripe reintenta el cobro. Dispones de un periodo de gracia de 7 días para regularizarlo manteniendo tu plan. Si no se regulariza en ese plazo, tu cuenta pasa al plan Free hasta que el pago se resuelva.',
            },
          ],
        },
        {
          heading: 'Derecho de desistimiento',
          blocks: [
            {
              p: 'Si eres consumidor, tienes derecho a desistir del contrato en un plazo de 14 días naturales sin indicar el motivo (Real Decreto Legislativo 1/2007, TRLGDCU, art. 71 y siguientes). Para ejercerlo escríbenos a [{entity.email}](mailto:{entity.email}) manifestando con claridad tu decisión.',
            },
            {
              p: 'Como el Servicio es contenido digital que se pone a tu disposición de forma inmediata, antes de cobrarte te pediremos, mediante una casilla en el proceso de pago, que solicites expresamente el acceso inmediato y que reconozcas que, una vez comenzado el suministro, pierdes el derecho de desistimiento en los términos del art. 103 TRLGDCU. Sin esa confirmación no podemos iniciar el cobro. Si desistes dentro del plazo antes de que se haya iniciado el suministro, te reembolsaremos el importe pagado.',
            },
            { p: 'Este derecho no se aplica a quien contrata como profesional o empresa.' },
          ],
        },
        {
          heading: 'Uso aceptable',
          blocks: [
            { p: 'Te comprometes a no usar el Servicio para:' },
            {
              ul: [
                'Actividades ilegales, ni para alojar o difundir contenido ilícito, malicioso, de suplantación (phishing) o malware.',
                'Extraer o recopilar datos de la plataforma de forma automatizada (scraping) o sondearla en busca de vulnerabilidades sin autorización.',
                'Superar o eludir los límites de uso y las cuotas de tu plan, sobrecargar la infraestructura, o lanzar ataques de denegación de servicio contra el Servicio o a través de él.',
                'Revender el acceso o hacerte pasar por otra persona.',
                'Conectar repositorios sobre los que no tengas derecho a trabajar o cuya licencia no lo permita, ni incluir datos personales reales de terceros en tus mocks.',
              ],
            },
            {
              p: 'Las APIs simuladas tienen límites de peticiones y de recursos que se muestran en tu plan y pueden aplicarse límites de velocidad adicionales para proteger el Servicio. Podemos limitar, bloquear o suspender el uso que incumpla esta cláusula.',
            },
          ],
        },
        {
          id: 'demo',
          heading: 'Demo pública sin registro',
          blocks: [
            {
              p: 'La demo pública permite probar el generador sin crear una cuenta. Se ofrece gratis y «tal cual», y además de las demás cláusulas de estos Términos se aplican estas condiciones:',
            },
            {
              ul: [
                '**Uso aceptable:** úsala tú, a mano y sin automatizar (nada de bots, scripts ni rastreadores). Está prohibido el abuso: esquivar sus límites o la comprobación anti-bot (por ejemplo, cambiando de dirección), sobrecargarla, usarla como asistente de IA de propósito general o para obtener contenido ajeno a las APIs simuladas.',
                '**Sin datos personales reales ni secretos:** no pegues datos personales reales de terceros, contraseñas, claves ni otros secretos o información confidencial, ni material que no tengas derecho a compartir: el texto se envía a un proveedor de IA de terceros (véase la [Política de Privacidad](/privacy#demo)). Además, la API simulada que se genera puede reproducir fragmentos de lo que pegas, se conserva 30 minutos y cualquiera que tenga su dirección puede consultarla: por eso no pegues datos personales, secretos ni credenciales.',
                '**Límites:** cada visitante dispone de un número pequeño de generaciones al día y toda la demo de un tope diario; cada API simulada tiene como máximo 5 endpoints con respuestas pequeñas y un número máximo de peticiones. Una generación cuenta desde que la petición sale hacia el proveedor de IA, aunque el modelo falle o devuelva algo inutilizable: no se devuelve. Si se alcanza el tope, la demo lo avisa y volverá a estar disponible el siguiente día UTC.',
                '**Efímera y no privada:** la API simulada dura 30 minutos y después desaparece. Mientras dura, cualquiera que conozca su dirección (larga y aleatoria) puede llamarla, así que no la trates como privada. No se puede exportar ni proteger con claves de API; para conservar una API, crea una cuenta.',
                '**Sin ninguna garantía:** la demo se ofrece sin ninguna garantía de disponibilidad, exactitud ni idoneidad; la IA puede fallar o generar resultados absurdos. Lo generado es ficticio, sirve para probar y no debe usarse para tomar decisiones.',
                '**El titular puede apagarla:** podemos limitar, modificar, suspender o apagar la demo en cualquier momento y sin previo aviso, y bloquear el uso que incumpla estas condiciones.',
              ],
            },
          ],
        },
        {
          heading: 'Tu contenido y los resultados generados',
          blocks: [
            {
              p: 'Conservas todos los derechos sobre tu contenido (tus instrucciones y el código y la documentación de tus repositorios, que siguen siendo de quien corresponda). Nos concedes una licencia limitada, no exclusiva y mundial, solo para tratarlo con el fin de prestarte el Servicio, lo que incluye enviarlo al proveedor de IA tal como explica la [Política de Privacidad](/privacy). Solo si lo activas expresamente (es opcional), también para mejorar la IA de Mockia.io en los términos de esa política.',
            },
            {
              p: 'En la medida en que la ley lo permita, los resultados generados para ti (endpoints, respuestas y datos de ejemplo) son tuyos y puedes usarlos libremente, también con fines comerciales. Es posible que otros usuarios obtengan resultados parecidos y no garantizamos que los resultados sean únicos ni que estén libres de derechos de terceros.',
            },
          ],
        },
        {
          heading: 'Resultados de la IA',
          blocks: [
            {
              p: 'Los resultados generados con inteligencia artificial pueden ser inexactos, incompletos o inadecuados. Revísalos antes de usarlos y no los utilices como única base para decisiones importantes. Los datos de ejemplo son ficticios.',
            },
          ],
        },
        {
          heading: 'Disponibilidad',
          blocks: [
            {
              p: 'Procuramos que el Servicio esté disponible, pero no garantizamos que lo esté de forma ininterrumpida ni libre de errores. El plan Free se ofrece sin ningún compromiso de disponibilidad ni de soporte. Los planes de pago tampoco incluyen un acuerdo de nivel de servicio (SLA) salvo que se pacte por escrito. Podemos realizar tareas de mantenimiento y modificar o retirar funciones.',
            },
          ],
        },
        {
          heading: 'Propiedad intelectual de Mockia.io',
          blocks: [
            {
              p: 'El Servicio, su software, diseño y marcas son de {entity.name} o de sus licenciantes. Estos Términos no te transfieren ningún derecho sobre ellos salvo el de uso conforme a lo aquí previsto.',
            },
          ],
        },
        {
          heading: 'Limitación de responsabilidad',
          blocks: [
            {
              p: 'En la medida en que la ley lo permita, no respondemos de daños indirectos, lucro cesante, pérdida de datos o de oportunidades derivados del uso o de la imposibilidad de usar el Servicio. Cuando seas un profesional o empresa, nuestra responsabilidad total se limita a lo que hayas pagado por el Servicio en los 12 meses anteriores al hecho que la origine.',
            },
            {
              p: 'Nada de lo anterior excluye ni limita la responsabilidad que no pueda excluirse o limitarse legalmente (por ejemplo, por dolo o negligencia grave) ni los derechos irrenunciables que la ley reconoce a los consumidores.',
            },
          ],
        },
        {
          heading: 'Suspensión y terminación',
          blocks: [
            {
              p: 'Puedes dejar de usar el Servicio y eliminar tu cuenta cuando quieras. Podemos suspender o cerrar tu cuenta si incumples estos Términos de forma grave o reiterada, avisándote salvo que haya un riesgo urgente. Al terminar, tratamos tus datos según la [Política de Privacidad](/privacy).',
            },
          ],
        },
        {
          heading: 'Cambios en los Términos',
          blocks: [
            {
              p: 'Podemos modificar estos Términos. Te avisaremos por email o en la aplicación con una antelación razonable antes de que los cambios sustanciales entren en vigor. Si no estás de acuerdo, puedes cancelar tu suscripción y dejar de usar el Servicio; si sigues usándolo después de esa fecha, aceptas la nueva versión.',
            },
          ],
        },
        {
          heading: 'Ley aplicable y jurisdicción',
          blocks: [
            {
              p: 'Estos Términos se rigen por la ley española. Si eres consumidor, te amparan además las normas imperativas de protección de consumidores de tu país de residencia y puedes acudir a los tribunales de tu domicilio. En los demás casos, las partes se someten a los juzgados y tribunales que resulten competentes conforme a la normativa aplicable.',
            },
          ],
        },
        {
          heading: 'Contacto',
          blocks: [
            {
              p: 'Para cualquier duda sobre estos Términos escribe a [{entity.email}](mailto:{entity.email}).',
            },
          ],
        },
      ],
    },

    // ---------------------------------------------------------------------------------------------------------
    cookies: {
      title: 'Política de Cookies',
      sections: [
        {
          heading: 'Qué usa Mockia.io',
          blocks: [
            {
              p: 'Mockia.io usa una única cookie y unos pocos datos en el almacenamiento local de tu navegador. **Todos son estrictamente necesarios** para que el Servicio funcione o para recordar una elección tuya. No usamos cookies de analítica, de publicidad ni de seguimiento, ni de terceros.',
            },
            {
              table: {
                head: ['Nombre', 'Tipo', 'Finalidad', 'Duración'],
                rows: [
                  [
                    '`mockia_rt`',
                    'Cookie propia, HttpOnly (el código de la página no puede leerla), SameSite, con atributo Secure en producción. Solo se envía a las rutas de autenticación (`/api/auth`).',
                    'Mantener tu sesión iniciada: permite renovar el acceso sin pedirte la contraseña de nuevo.',
                    'Hasta 7 días si marcas «Recordarme»; si no, es de sesión y desaparece al cerrar el navegador.',
                  ],
                  [
                    '`mockia_locale`',
                    'Almacenamiento local (localStorage).',
                    'Recordar el idioma de la interfaz que has elegido.',
                    'Hasta que lo borres.',
                  ],
                  [
                    '`mockia_last_visited`',
                    'Almacenamiento local (localStorage).',
                    'Ordenar tus proyectos por el último que abriste en este navegador.',
                    'Hasta que lo borres.',
                  ],
                  [
                    '`mockia_cookie_notice_dismissed`',
                    'Almacenamiento local (localStorage).',
                    'Recordar que has cerrado el aviso informativo sobre cookies para no mostrártelo de nuevo.',
                    'Hasta que lo borres.',
                  ],
                  [
                    '`mockia_verify_banner_dismissed`',
                    'Almacenamiento de sesión (sessionStorage).',
                    'Recordar que has cerrado el aviso de verificación del email mientras la pestaña siga abierta.',
                    'Hasta que cierres la pestaña.',
                  ],
                ],
              },
            },
            {
              p: 'El token de acceso de corta duración se mantiene solo en la memoria de la página: no se guarda ni en cookies ni en el almacenamiento del navegador.',
            },
          ],
        },
        {
          id: 'demo',
          heading: 'Demo pública sin registro',
          blocks: [
            {
              p: 'La demo pública no usa cookies ni almacenamiento local, y no añade ninguna entrada a la tabla anterior mientras la pruebas. Solo si decides guardar el proyecto (pulsando el botón para crear tu cuenta desde el resultado de la demo), el identificador de tu demo se guarda en el almacenamiento de sesión de esta pestaña hasta que lo reclames o la cierres; es estrictamente necesario para esa función, no se usa para nada más y se borra al reclamarlo, al caducar la demo o al cerrar la pestaña. La comprobación anti-bot se calcula en la memoria de la página y no se guarda, y no cargamos ningún servicio de terceros. Tu dirección IP se trata como se explica en la [Política de Privacidad](/privacy#demo).',
            },
          ],
        },
        {
          heading: 'Aviso informativo, no banner de consentimiento',
          blocks: [
            {
              p: 'Al entrar en el sitio mostramos un aviso informativo con un único botón «Entendido». Lo mostramos solo por transparencia, no para pedirte consentimiento: el artículo 22.2 de la LSSI-CE exige consentimiento previo para las cookies y tecnologías similares, salvo las estrictamente necesarias para prestar un servicio que el usuario ha solicitado expresamente (como mantener la sesión o recordar el idioma). Como solo usamos de ese tipo, no necesitamos tu consentimiento y no hay nada que aceptar ni rechazar. Al pulsar «Entendido» solo guardamos que has cerrado el aviso (`mockia_cookie_notice_dismissed`).',
            },
            {
              p: 'Si en el futuro añadiéramos analítica, publicidad o contenido de terceros no esencial, pediremos tu consentimiento antes de activarlos, con una opción de rechazar tan sencilla como la de aceptar, y actualizaremos esta política.',
            },
          ],
        },
        {
          heading: 'Servicios de terceros',
          blocks: [
            {
              p: 'Cuando vas a pagar o gestionar tu suscripción, te llevamos a páginas alojadas por Stripe, que puede usar sus propias cookies según su política ([stripe.com/privacy](https://stripe.com/privacy)). Esas cookies no las controla Mockia.io.',
            },
          ],
        },
        {
          heading: 'Cómo borrarlas o bloquearlas',
          blocks: [
            {
              p: 'Puedes eliminar la cookie y los datos locales desde la configuración de tu navegador. Si borras `mockia_rt` se cerrará tu sesión; si borras `mockia_locale` volveremos a elegir el idioma según tu navegador. Si bloqueas la cookie de sesión no podrás mantener la sesión iniciada.',
            },
            {
              p: 'Más información sobre cómo tratamos tus datos en la [Política de Privacidad](/privacy).',
            },
          ],
        },
      ],
    },
  },
}

export default es
