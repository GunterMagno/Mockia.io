// Documentos legales: Aviso Legal (LSSI), Privacidad (RGPD art. 13), Terminos y Cookies, en los tres idiomas.
// El idioma se fuerza con la preferencia guardada, como en el resto de specs.
type Lang = 'es' | 'en' | 'zh';

const PAGES = ['/legal', '/privacy', '/terms', '/cookies'] as const;

const visitIn = (path: string, lang: Lang) =>
  cy.visit(path, { onBeforeLoad: (win) => win.localStorage.setItem('mockia_locale', lang) });

const HTML_LANG: Record<Lang, string> = { es: 'es', en: 'en', zh: 'zh-CN' };

describe('Legal: las cuatro paginas existen y estan completas', () => {
  for (const lang of ['es', 'en', 'zh'] as Lang[]) {
    for (const path of PAGES) {
      it(`${path} (${lang}): h1, fecha de actualizacion y sin la afirmacion falsa de cifrado`, () => {
        visitIn(path, lang);
        cy.location('pathname').should('eq', path);
        cy.get('article[data-legal]').should('have.attr', 'lang', HTML_LANG[lang]);
        cy.get('article h1').should('have.length', 1).and('not.be.empty');
        cy.get('[data-legal-updated]').should('contain.text', '2026');
        cy.get('article').invoke('text').should('not.match', /encrypted at rest/i);
        // el aviso "solo en ingles" ya no existe
        cy.get('[role="note"]').should('not.exist');
      });
    }
  }
});

describe('Legal: contenido segun el idioma', () => {
  it('en espanol los textos estan en espanol y sin el aviso de "solo ingles"', () => {
    for (const path of PAGES) {
      visitIn(path, 'es');
      cy.get('article h1').invoke('text').should('match', /Aviso Legal|Política de Privacidad|Términos|Cookies/);
      cy.get('article').invoke('text').should('not.match', /solo está disponible en inglés|available in English only/i);
    }
    visitIn('/privacy', 'es');
    cy.contains('article h2', /derechos/i).should('exist');
    cy.get('a[href="https://www.aepd.es"]').should('exist');
  });

  it('en chino renderiza texto no latino en todas las paginas', () => {
    for (const path of PAGES) {
      visitIn(path, 'zh');
      cy.get('article h1').invoke('text').should('match', /[一-鿿]/);
      cy.get('article').invoke('text').should('match', /[一-鿿]{20,}/);
    }
  });

  it('Privacidad y Terminos recogen los pagos con Stripe', () => {
    for (const lang of ['es', 'en', 'zh'] as Lang[]) {
      for (const path of ['/privacy', '/terms']) {
        visitIn(path, lang);
        cy.get('article').should('contain.text', 'Stripe');
      }
    }
  });

  it('Cookies lista la cookie de sesion mockia_rt y la clave de idioma que usa la app', () => {
    for (const lang of ['es', 'en', 'zh'] as Lang[]) {
      visitIn('/cookies', lang);
      cy.get('article')
        .should('contain.text', 'mockia_rt')
        .and('contain.text', 'mockia_locale')
        .and('contain.text', 'mockia_cookie_notice_dismissed');
    }
  });

  it('Privacidad dice que no se almacenan tokens de GitHub (se clonan repositorios publicos)', () => {
    visitIn('/privacy', 'en');
    cy.get('article').invoke('text').should('match', /public repositor/i);
  });

  it('mientras falten los datos del titular se ven marcadores visibles y el aviso de borrador', () => {
    visitIn('/legal', 'es');
    cy.get('[data-legal-draft]').should('be.visible').and('contain.text', 'Borrador pendiente de revisión jurídica');
    cy.get('[data-legal-placeholder]').should('have.length.at.least', 1).first().should('contain.text', 'pendiente');
    visitIn('/legal', 'en');
    cy.get('[data-legal-draft]').should('contain.text', 'Draft pending legal review');
  });
});

describe('Legal: enlaces desde el footer y el registro', () => {
  it('el footer enlaza a los cuatro documentos', () => {
    visitIn('/', 'es');
    for (const path of PAGES) {
      cy.get('footer a[href="' + path + '"]').should('have.length', 1);
    }
    cy.get('footer a[href="/cookies"]').click();
    cy.location('pathname').should('eq', '/cookies');
    cy.get('article h1').should('contain.text', 'Cookies');
  });

  it('el registro avisa de que se aceptan Terminos y Privacidad, sin casilla bloqueante', () => {
    visitIn('/signup', 'es');
    cy.get('[data-signup-legal]')
      .should('contain.text', 'Al registrarte aceptas')
      .within(() => {
        cy.get('a[href="/terms"]').should('exist');
        cy.get('a[href="/privacy"]').should('exist');
      });
    // sin casilla bloqueante (la de "Recordarme" no es de aceptacion)
    cy.get('form input[type="checkbox"][required]').should('not.exist');
    visitIn('/signup', 'en');
    cy.get('[data-signup-legal]').should('contain.text', 'By signing up you accept');
    visitIn('/signup', 'zh');
    cy.get('[data-signup-legal]').invoke('text').should('match', /[一-鿿]/);
  });
});

describe('Legal: la web no carga recursos de terceros que los textos no mencionen', () => {
  it('la animacion "como funciona" se sirve con GSAP propio y sin Google Fonts ni CDNs', () => {
    cy.request('/como-funciona/index.html').its('body').then((html: string) => {
      expect(html).to.not.match(/fonts\.googleapis|fonts\.gstatic|cdnjs|jsdelivr|unpkg/i);
      expect(html).to.include('vendor/gsap.min.js');
    });
    cy.request('/como-funciona/vendor/gsap.min.js').its('body').should('include', 'GSAP 3.15.0');
  });

  it('Privacidad y Cookies ya no citan Google Fonts', () => {
    for (const lang of ['es', 'en', 'zh'] as Lang[]) {
      for (const path of ['/privacy', '/cookies']) {
        visitIn(path, lang);
        cy.get('article').invoke('text').should('not.match', /google/i);
      }
    }
  });
});

describe('Legal: lo que promete la web coincide con los Terminos y la Privacidad', () => {
  it('Privacidad dice que al proveedor de IA tambien van el titulo y la descripcion del proyecto y la URL y el propietario del repositorio', () => {
    const expected: Record<Lang, RegExp[]> = {
      en: [/title and description of the project/i, /repository URL and its owner/i],
      es: [/título y la descripción del proyecto/i, /URL del repositorio y su propietario/i],
      zh: [/项目的标题和描述/, /仓库的 URL 及其所有者/],
    };
    for (const lang of ['es', 'en', 'zh'] as Lang[]) {
      visitIn('/privacy', lang);
      for (const re of expected[lang]) cy.get('article').invoke('text').should('match', re);
    }
  });

  // Los Terminos no comprometen soporte para Free (ruling R15) y la sincronizacion es por sondeo, no en tiempo real
  it('la tarjeta Free no promete soporte por correo y la portada no habla de tiempo real', () => {
    const copy: Record<Lang, { support: RegExp; realtime: RegExp; sync: string }> = {
      en: { support: /Email support/, realtime: /Real-time sync/i, sync: 'Changes sync automatically' },
      es: { support: /Soporte por correo/, realtime: /tiempo real/i, sync: 'Los cambios se sincronizan solos' },
      zh: { support: /邮件支持/, realtime: /实时同步/, sync: '更改会自动同步' },
    };
    for (const lang of ['es', 'en', 'zh'] as Lang[]) {
      visitIn('/', lang);
      cy.get('body').invoke('text').should('not.match', copy[lang].support).and('not.match', copy[lang].realtime);
      cy.contains(copy[lang].sync).should('exist');
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Demo publica sin registro (tarea B5). Los textos tienen que decir lo que el servidor hace de verdad:
//  - la IP solo se guarda como HMAC-SHA256 con sal que cambia cada dia UTC (nunca en claro en la base de datos),
//    PERO el servidor registra la IP en claro en sus logs de acceso: eso se declara y la retencion queda marcada
//    como pendiente del titular;
//  - el texto del visitante NO se guarda, pero SI se envia al proveedor de IA;
//  - contadores >= 48 h; mocks y contenido generado, 30 minutos; sin cookies ni almacenamiento local.
// ---------------------------------------------------------------------------------------------------------------
const REVIEW_MARKER = '[[REVISAR: retención de logs del hosting]]';

interface DemoPrivacyCopy {
  purpose: RegExp;
  basis: RegExp;
  hmac: RegExp[];
  noStoredText: RegExp;
  sentToProvider: RegExp[];
  logsDeclared: RegExp[];
  ttl: RegExp[];
  noClientStorage: RegExp[];
  objection: RegExp;
  /** Afirmaciones que serian falsas: la IP en claro como dato que se guarda en la base de la demo. */
  forbidden: RegExp[];
}

// Ronda de arreglos de la revision (B5-I1, I2, m3, m4/m5): ponderacion coherente con los logs en claro, la API generada
// puede reproducir lo pegado, el seudonimo "por si solo", y filas de plazos buscadas por su primera celda.
interface Round2Copy {
  /** Frases de la ponderacion del interes legitimo (seccion de la demo y fila de finalidades). */
  weighing: RegExp[];
  /** Afirmaciones falsas que no deben quedar en ninguna parte de Privacidad. */
  falseClaims: RegExp[];
  /** "La API generada puede reproducir fragmentos de lo que pegas" (Privacidad y Terminos). */
  reproduces: RegExp;
  /** El seudonimo solo no permite seguirte (los logs si contienen la IP). */
  alone: RegExp;
  /** Primera celda de las filas de plazos de la demo. */
  counterRow: RegExp;
  mockRow: RegExp;
  /** Primera celda de la fila de finalidades de la demo. */
  purposeRow: RegExp;
}

const ROUND2: Record<Lang, Round2Copy> = {
  es: {
    weighing: [/la base de datos de la demo solo guarda datos seudonimizados/, /registros de acceso generales del servidor/, /sin perfilado ni cookies/],
    falseClaims: [/solo se tratan datos seudonimizados/, /limitándose a datos seudonimizados/],
    reproduces: /[Pp]uede reproducir fragmentos de lo que pegas/,
    alone: /el seudónimo por sí solo no permite/,
    purposeRow: /Ofrecer una demo sin registro y evitar abusos de la demo/,
    counterRow: /Demo pública: contadores diarios/,
    mockRow: /Demo pública: la API simulada generada/,
  },
  en: {
    weighing: [/the demo's database only holds pseudonymized/, /general server access logs/, /no profiling or cookies/],
    falseClaims: [/only pseudonymized[^.]{0,40}data is processed/, /limited to pseudonymized, short-lived data/],
    reproduces: /may reproduce fragments of what you paste/,
    alone: /the pseudonym alone does not/,
    purposeRow: /Offering a demo without registration/,
    counterRow: /Public demo: daily counters/,
    mockRow: /Public demo: the generated mock API/,
  },
  zh: {
    weighing: [/演示的数据库只保存假名化数据/, /一般访问日志/, /没有用户画像和 Cookie/],
    falseClaims: [/只处理假名化/, /仅限于假名化的短期数据/],
    reproduces: /可能复述你粘贴内容中的片段/,
    alone: /仅凭该假名无法/,
    purposeRow: /提供无需注册的演示并防止滥用（每位访客/,
    counterRow: /公开演示：带有 IP 假名的每日计数器/,
    mockRow: /公开演示：生成的模拟 API 及其内容/,
  },
};

const DEMO_PRIVACY: Record<Lang, DemoPrivacyCopy> = {
  es: {
    purpose: /ofrecer una demo sin registro y evitar abusos/i,
    basis: /interés legítimo \(art\. 6\.1\.f\)/i,
    hmac: [/HMAC-SHA256/, /sal que cambia cada día UTC/, /prefijo \/64/],
    noStoredText: /No guardamos ese texto/,
    sentToProvider: [/se envía al proveedor de IA/, /OpenRouter/, /modelo alojado en nuestra propia infraestructura/],
    logsDeclared: [/registros de acceso del servidor/i, /dirección IP en claro/i, /no incluyen el texto que pegas/i],
    ttl: [/48 horas/, /30 minutos/],
    noClientStorage: [/no usa cookies/i, /almacenamiento local/i],
    objection: /derecho de oposición/i,
    forbidden: [/se guarda la dirección IP en claro/i, /guardamos tu dirección IP en claro/i],
  },
  en: {
    purpose: /offer a demo without registration and to prevent abuse/i,
    basis: /legitimate interest \(art\. 6\.1\.f\)/i,
    hmac: [/HMAC-SHA256/, /salt that changes every UTC day/, /\/64 prefix/],
    noStoredText: /We do not store that text/,
    sentToProvider: [/sent to the AI provider/, /OpenRouter/, /model hosted on our own infrastructure/],
    logsDeclared: [/server access logs/i, /IP address in clear text/i, /do not include the text you paste/i],
    ttl: [/48 hours/, /30 minutes/],
    noClientStorage: [/does not use cookies/i, /local storage/i],
    objection: /right to object/i,
    forbidden: [/IP address is stored in clear/i, /we store your IP address in clear/i],
  },
  zh: {
    purpose: /提供无需注册的演示并防止滥用/,
    basis: /正当利益（第 6\.1\.f 条）/,
    hmac: [/HMAC-SHA256/, /每个 UTC 日更换的盐值/, /\/64 前缀/],
    noStoredText: /我们不会保存该文本/,
    sentToProvider: [/发送给 AI 模型提供商/, /OpenRouter/, /托管在自有基础设施上的模型/],
    logsDeclared: [/服务器访问日志/, /明文的 IP 地址/, /不包含你粘贴的文本/],
    ttl: [/48 小时/, /30 分钟/],
    noClientStorage: [/不使用 Cookie/, /本地存储/],
    objection: /反对权/,
    forbidden: [/以明文保存 IP 地址/, /明文保存你的 IP/],
  },
};

describe('Legal: la demo publica sin registro (Privacidad)', () => {
  for (const lang of ['es', 'en', 'zh'] as Lang[]) {
    const copy = DEMO_PRIVACY[lang];

    it(`Privacidad (${lang}): seccion de la demo con finalidad, base juridica y derecho de oposicion`, () => {
      visitIn('/privacy', lang);
      cy.get('section#demo').should('exist').invoke('text').then((text) => {
        expect(text).to.match(copy.purpose);
        expect(text).to.match(copy.basis);
        expect(text).to.match(copy.objection);
      });
    });

    it(`Privacidad (${lang}): la IP se guarda pseudonimizada (HMAC con sal diaria) y nunca en claro en la base de la demo`, () => {
      visitIn('/privacy', lang);
      cy.get('section#demo').invoke('text').then((text) => {
        for (const re of copy.hmac) expect(text, String(re)).to.match(re);
        for (const re of copy.forbidden) expect(text, String(re)).to.not.match(re);
      });
    });

    it(`Privacidad (${lang}): el texto no se guarda pero si se envia al proveedor de IA (OpenRouter o modelo propio)`, () => {
      visitIn('/privacy', lang);
      cy.get('section#demo').invoke('text').then((text) => {
        expect(text).to.match(copy.noStoredText);
        for (const re of copy.sentToProvider) expect(text, String(re)).to.match(re);
      });
    });

    it(`Privacidad (${lang}): declara los logs del servidor con la IP en claro y deja la retencion como pendiente del titular`, () => {
      visitIn('/privacy', lang);
      cy.get('section#demo').invoke('text').then((text) => {
        for (const re of copy.logsDeclared) expect(text, String(re)).to.match(re);
      });
      cy.get('article').should('contain.text', REVIEW_MARKER);
    });

    it(`Privacidad (${lang}): plazos de la demo (contadores 48 h, mock y contenido generado 30 min) tambien en la tabla de plazos`, () => {
      visitIn('/privacy', lang);
      cy.get('section#demo').invoke('text').then((text) => {
        for (const re of copy.ttl) expect(text, String(re)).to.match(re);
      });
      // las filas de la demo estan en la tabla de "cuanto tiempo conservamos" (se buscan por su primera celda: la
      // fila preexistente "24 horas y 30 minutos" de los enlaces de restablecimiento no cuenta)
      cy.contains('tr', ROUND2[lang].counterRow).invoke('text').should('match', copy.ttl[0]);
      cy.contains('tr', ROUND2[lang].mockRow).invoke('text').should('match', copy.ttl[1]);
    });

    it(`Privacidad (${lang}): la demo no usa cookies ni almacenamiento local`, () => {
      visitIn('/privacy', lang);
      cy.get('section#demo').invoke('text').then((text) => {
        for (const re of copy.noClientStorage) expect(text, String(re)).to.match(re);
      });
    });
  }
});

describe('Legal: la demo publica sin registro (Terminos)', () => {
  const TERMS: Record<Lang, { acceptable: RegExp[]; noWarranty: RegExp; limits: RegExp[]; switchOff: RegExp }> = {
    es: {
      acceptable: [/sin automatizar/i, /datos personales reales/i, /secretos/i, /abuso/i],
      noWarranty: /sin ninguna garantía/i,
      limits: [/no se devuelve/i, /30 minutos/, /5 endpoints/],
      switchOff: /apagar/i,
    },
    en: {
      acceptable: [/do not automate/i, /real personal data/i, /secrets/i, /abuse/i],
      noWarranty: /without any warranty/i,
      limits: [/not given back/i, /30 minutes/, /5 endpoints/],
      switchOff: /switch (it )?off/i,
    },
    zh: {
      acceptable: [/不得自动化/, /真实的个人数据/, /机密/, /滥用/],
      noWarranty: /不提供任何担保/,
      limits: [/不会返还/, /30 分钟/, /5 个端点/],
      switchOff: /关闭/,
    },
  };

  for (const lang of ['es', 'en', 'zh'] as Lang[]) {
    it(`Terminos (${lang}): uso aceptable de la demo, sin garantias, limites y que el titular puede apagarla`, () => {
      visitIn('/terms', lang);
      cy.get('section#demo').should('exist').invoke('text').then((text) => {
        const c = TERMS[lang];
        for (const re of [...c.acceptable, ...c.limits]) expect(text, String(re)).to.match(re);
        expect(text).to.match(c.noWarranty);
        expect(text).to.match(c.switchOff);
      });
    });
  }
});

describe('Legal: la demo publica sin registro (Cookies)', () => {
  const COOKIE_DEMO: Record<Lang, RegExp[]> = {
    es: [/La demo pública no usa cookies/, /ni almacenamiento local ni de sesión/],
    en: [/The public demo does not use cookies/, /nor local or session storage/],
    zh: [/公开演示不使用 Cookie/, /也不使用本地存储或会话存储/],
  };

  for (const lang of ['es', 'en', 'zh'] as Lang[]) {
    it(`Cookies (${lang}): la demo declara que no usa cookies ni almacenamiento local`, () => {
      visitIn('/cookies', lang);
      cy.get('section#demo').should('exist').invoke('text').then((text) => {
        for (const re of COOKIE_DEMO[lang]) expect(text, String(re)).to.match(re);
      });
    });

    it(`Cookies (${lang}): la tabla sigue listando exactamente las 5 entradas de siempre, ninguna nueva por la demo`, () => {
      visitIn('/cookies', lang);
      cy.get('article table tbody tr').should('have.length', 5);
      cy.get('article table tbody tr td:first-child').then(($cells) => {
        const names = [...$cells].map((c) => c.textContent?.trim());
        expect(names).to.deep.equal([
          'mockia_rt',
          'mockia_locale',
          'mockia_last_visited',
          'mockia_cookie_notice_dismissed',
          'mockia_verify_banner_dismissed',
        ]);
      });
      cy.get('article table').invoke('text').should('not.match', /demo/i);
    });
  }

  it('Cookies y Privacidad no citan CAPTCHA ni servicios de terceros nuevos para la demo (la prueba de trabajo es propia)', () => {
    for (const lang of ['es', 'en', 'zh'] as Lang[]) {
      for (const path of ['/cookies', '/privacy']) {
        visitIn(path, lang);
        cy.get('article').invoke('text').should('not.match', /turnstile|recaptcha|hcaptcha|altcha/i);
      }
    }
  });
});

describe('Legal: ronda de arreglos de la demo (ponderacion, API generada, seudonimo)', () => {
  for (const lang of ['es', 'en', 'zh'] as Lang[]) {
    const r = ROUND2[lang];

    it(`Privacidad (${lang}): la ponderacion del interes legitimo distingue la base de datos seudonimizada de los logs con la IP`, () => {
      visitIn('/privacy', lang);
      cy.get('section#demo').invoke('text').then((text) => {
        for (const re of r.weighing) expect(text, String(re)).to.match(re);
      });
      // y la fila de finalidades de la tabla dice lo mismo
      cy.contains('tr', r.purposeRow).invoke('text').then((text) => {
        for (const re of r.weighing) expect(text, String(re)).to.match(re);
      });
      cy.get('article').invoke('text').then((text) => {
        for (const re of r.falseClaims) expect(text, String(re)).to.not.match(re);
      });
    });

    it(`Privacidad (${lang}): la API generada puede reproducir lo pegado, dura 30 min y es consultable con su URL`, () => {
      visitIn('/privacy', lang);
      cy.get('section#demo').invoke('text').then((text) => {
        expect(text).to.match(r.reproduces);
        expect(text).to.match(DEMO_PRIVACY[lang].ttl[1]);
      });
      // tambien en la fila de plazos de la API generada
      cy.contains('tr', r.mockRow).invoke('text').should('match', r.reproduces);
    });

    it(`Terminos (${lang}): el resultado puede reproducir lo pegado y es publico por URL durante 30 min`, () => {
      visitIn('/terms', lang);
      cy.get('section#demo').invoke('text').then((text) => {
        expect(text).to.match(r.reproduces);
        expect(text).to.match(DEMO_PRIVACY[lang].ttl[1]);
      });
    });

    it(`Privacidad (${lang}): el seudonimo por si solo no permite seguirte, pero los logs si contienen la IP`, () => {
      visitIn('/privacy', lang);
      cy.get('section#demo').invoke('text').then((text) => {
        expect(text).to.match(r.alone);
        expect(text).to.match(DEMO_PRIVACY[lang].logsDeclared[1]);
      });
    });
  }
});
