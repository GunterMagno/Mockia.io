import React, { useState } from 'react';
import Button from '../components/ui/Button/Button';
import Card from '../components/ui/Card/Card';
import Input from '../components/ui/Input/Input';
import Modal from '../components/ui/Modal/Modal';

export const DemoPage: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  return (
    <div className="container">
      <Card title="UI Base Demo">
        <Input label="Name" value={name} onChange={(e) => setName((e.target as HTMLInputElement).value)} placeholder="Type your name" />
        <Button onClick={() => setOpen(true)}>Open Modal</Button>
      </Card>
      <Modal isOpen={open} onClose={() => setOpen(false)} title="Demo Modal">
        <p>Hello {name || 'user'}! This is a demonstration modal.</p>
        <Button onClick={() => setOpen(false)}>Close</Button>
      </Modal>
    </div>
  );
};

export default DemoPage;
