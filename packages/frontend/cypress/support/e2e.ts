// Se carga antes de cada spec. El aviso informativo de cookies queda cerrado por defecto para que no tape controles
// en las pruebas de otras pantallas; cookies.cy.ts activa `showCookieNotice` para probar el aviso de verdad.
Cypress.on('window:before:load', (win) => {
  if (Cypress.env('showCookieNotice')) return;
  try {
    win.localStorage.setItem('mockia_cookie_notice_dismissed', '1');
  } catch {
    // sin almacenamiento no hay nada que cerrar
  }
});
