Cypress.on('window:before:load', (win) => {
  const methods = ['log', 'error', 'warn', 'info'] as const;
  methods.forEach((method) => {
    const original = win.console[method];
    win.console[method] = (...args: any[]) => {
      original.apply(win.console, args);
      const msg = args
        .map((arg) => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg)))
        .join(' ');
      cy.task('log', `[Browser ${method.toUpperCase()}] ${msg}`, { log: false });
    };
  });
});

Cypress.on('uncaught:exception', (err) => {
  cy.task('log', `[Browser UNCAUGHT EXCEPTION] ${err.message}\n${err.stack}`, { log: false });
  // Let it fail the test normally
});
