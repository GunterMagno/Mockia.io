import { useState } from 'react';

export function useCounter(initial = 0) {
  const [count, setCount] = useState(initial);
  const inc = () => setCount((c) => c + 1);
  const dec = () => setCount((c) => c - 1);
  return { count, inc, dec, setCount };
}

export default useCounter;
