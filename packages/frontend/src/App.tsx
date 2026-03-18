import { useState, useEffect } from 'react';
import './App.css';

interface HealthResponse {
  status: string;
  uptime: number;
}

function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('http://localhost:3000/api/health')
      .then((res) => res.json())
      .then((data) => setHealth(data))
      .catch((err) => setError(err.message));
  }, []);

  return (
    <div className="container">
      <header>
        <h1>🚀 Mockia.io</h1>
        <p>Generador de Mock APIs - Stack MERN</p>
      </header>

      <main>
        <section className="card">
          <h2>Backend Status</h2>
          {error ? (
            <p className="error">❌ {error}</p>
          ) : health ? (
            <div className="success">
              <p>✅ Conectado</p>
              <p>Uptime: {health.uptime.toFixed(2)}s</p>
            </div>
          ) : (
            <p>Cargando...</p>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
