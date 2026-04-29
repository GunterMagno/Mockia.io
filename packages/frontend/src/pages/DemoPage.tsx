import React, { useState } from 'react';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Input from '../components/ui/Input';
import Modal from '../components/ui/Modal';

export const DemoPage: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  return (
    <div className="container">
      <Card title="Demo UI Base">
        <Input label="Nombre" value={name} onChange={(e) => setName((e.target as HTMLInputElement).value)} placeholder="Escribe tu nombre" />
        <Button onClick={() => setOpen(true)}>Abrir Modal</Button>
      </Card>
      <Modal isOpen={open} onClose={() => setOpen(false)} title="Demo Modal">
        <p>Hola {name || 'usuario'}! Este es un modal de demostración.</p>
        <Button onClick={() => setOpen(false)}>Cerrar</Button>
      </Modal>
    </div>
  );
};

export default DemoPage;
