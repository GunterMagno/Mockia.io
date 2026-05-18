Cypress.on('window:before:load', (win) => {
  const methods = ['log', 'error', 'warn', 'info'] as const;
  methods.forEach((method) => {
    const original = win.console[method];
    win.console[method] = (...args: any[]) => {
      original.apply(win.console, args);
      const msg = args
        .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
        .join(' ');
      
      // Send logs to the backend via GET with no-cors mode to bypass preflights entirely
      const url = `http://localhost:3000/api/test-log?message=${encodeURIComponent(`[${method.toUpperCase()}] ${msg}`)}`;
      fetch(url, { mode: 'no-cors' }).catch(() => {});
    };
  });
});

Cypress.on('uncaught:exception', (err) => {
  const msg = `[UNCAUGHT EXCEPTION] ${err.message}\n${err.stack}`;
  const url = `http://localhost:3000/api/test-log?message=${encodeURIComponent(msg)}`;
  fetch(url, { mode: 'no-cors' }).catch(() => {});
  // Let it fail the test normally
});
