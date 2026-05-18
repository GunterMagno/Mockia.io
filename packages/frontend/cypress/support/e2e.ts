Cypress.on('window:before:load', (win) => {
  const methods = ['log', 'error', 'warn', 'info'] as const;
  methods.forEach((method) => {
    const original = win.console[method];
    win.console[method] = (...args: any[]) => {
      original.apply(win.console, args);
      const msg = args
        .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
        .join(' ');
      
      // Send logs to the backend via fetch to bypass Cypress command queue
      fetch('http://localhost:3000/api/test-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `[${method.toUpperCase()}] ${msg}` }),
      }).catch(() => {});
    };
  });
});

Cypress.on('uncaught:exception', (err) => {
  fetch('http://localhost:3000/api/test-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `[UNCAUGHT EXCEPTION] ${err.message}\n${err.stack}` }),
  }).catch(() => {});
  // Let it fail the test normally
});
