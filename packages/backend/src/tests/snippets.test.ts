import { generateSnippets } from '@mockia/shared';

describe('generateSnippets', () => {
  it('GET sin cuerpo: curl simple, fetch/axios/python correctos', () => {
    const s = generateSnippets({ method: 'get', url: 'https://api.mockia.io/x?a=1&b=2' });
    expect(s.curl).toBe("curl 'https://api.mockia.io/x?a=1&b=2'");
    expect(s.fetch).toContain('fetch("https://api.mockia.io/x?a=1&b=2", {');
    expect(s.fetch).toContain('method: "GET"');
    expect(s.axios).toContain('method: "get"');
    expect(s.python).toContain('requests.request(');
    expect(s.python).toContain('"GET",');
  });

  it('POST con objeto: añade Content-Type JSON y serializa en los 4 formatos', () => {
    const s = generateSnippets({
      method: 'POST',
      url: 'https://h/p',
      headers: { 'x-mockia-api-key': 'k1' },
      body: { name: 'Ana', ok: true, none: null, tags: ['a', 'b'] },
    });
    expect(s.curl).toContain('-X POST');
    expect(s.curl).toContain("-H 'Content-Type: application/json'");
    expect(s.curl).toContain(`-d '{"name":"Ana","ok":true,"none":null,"tags":["a","b"]}'`);
    expect(s.fetch).toContain('body: JSON.stringify({');
    expect(s.axios).toContain('data: {');
    expect(s.python).toContain('json={');
    expect(s.python).toContain('"ok": True');
    expect(s.python).toContain('"none": None');
  });

  it('no duplica Content-Type si ya viene (insensible a mayúsculas)', () => {
    const s = generateSnippets({ method: 'PUT', url: 'u', headers: { 'content-type': 'application/json' }, body: { a: 1 } });
    expect(s.curl.match(/Content-Type/gi)).toHaveLength(1);
  });

  it("escapa comillas simples en shell: ' => '\\''", () => {
    const s = generateSnippets({ method: 'POST', url: "https://h/it's", body: "o'brien" });
    expect(s.curl).toContain(`'https://h/it'\\''s'`);
    expect(s.curl).toContain(`-d 'o'\\''brien'`);
  });

  it('escapa comillas dobles y saltos de línea en JS y Python', () => {
    const s = generateSnippets({ method: 'POST', url: 'u', body: 'a "q"\nb' });
    expect(s.fetch).toContain('body: "a \\"q\\"\\nb"');
    expect(s.axios).toContain('data: "a \\"q\\"\\nb"');
    expect(s.python).toContain('data="a \\"q\\"\\nb"');
  });

  it('elimina CR/LF de headers (sin inyección de líneas)', () => {
    const s = generateSnippets({ method: 'GET', url: 'u', headers: { 'X-A': 'v\r\nX-Evil: 1' } });
    expect(s.curl).toContain("-H 'X-A: vX-Evil: 1'");
    expect(s.curl.split('\n')).toHaveLength(2);
  });

  it('verbo inválido cae a GET; HEAD usa -I; GET/HEAD ignoran el cuerpo', () => {
    expect(generateSnippets({ method: "GET'; rm -rf /", url: 'u' }).curl).toBe("curl 'u'");
    expect(generateSnippets({ method: 'HEAD', url: 'u' }).curl).toBe("curl -I 'u'");
    const g = generateSnippets({ method: 'GET', url: 'u', body: { a: 1 } });
    expect(g.curl).not.toContain('-d');
    expect(g.fetch).not.toContain('body');
  });

  it('cuerpos vacíos u objetos anidados en Python son literales válidos', () => {
    const s = generateSnippets({ method: 'PATCH', url: 'u', body: { a: {}, b: [], c: { d: [1, { e: false }] } } });
    expect(s.python).toContain('"a": {}');
    expect(s.python).toContain('"b": []');
    expect(s.python).toContain('"e": False');
  });
});
