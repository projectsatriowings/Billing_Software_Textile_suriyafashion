import React, { useEffect, useState } from 'react';

interface CartQtyInputProps {
  qty: number;
  onCommitQty: (newQty: number) => void;
  onStep: (delta: number) => void;
  disabled?: boolean;
}

/**
 * Editable numeric quantity input for the POS cart stepper.
 * Allows direct keyboard entry while preserving +/- and arrow-key stepping.
 */
export function CartQtyInput({ qty, onCommitQty, onStep, disabled }: CartQtyInputProps) {
  const [draft, setDraft] = useState(() => String(qty));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setDraft(String(qty));
    }
  }, [qty, isFocused]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const digitsOnly = e.target.value.replace(/[^0-9]/g, '');
    setDraft(digitsOnly);
    if (digitsOnly !== '') {
      const parsed = parseInt(digitsOnly, 10);
      if (parsed >= 1) {
        onCommitQty(parsed);
      }
    }
  };

  const handleBlur = () => {
    setIsFocused(false);
    const parsed = parseInt(draft, 10);
    if (!draft || isNaN(parsed) || parsed <= 0) {
      setDraft(String(qty));
      return;
    }
    onCommitQty(parsed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    } else if (e.key === 'Escape') {
      setDraft(String(qty));
      e.currentTarget.blur();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      onStep(1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      onStep(-1);
    }
  };

  return (
    <input
      type="text"
      inputMode="numeric"
      aria-label="Item quantity"
      className="bento-qty-input mono"
      value={isFocused ? draft : String(qty)}
      disabled={disabled}
      onFocus={(e) => {
        setIsFocused(true);
        setDraft(String(qty));
        e.currentTarget.select();
      }}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    />
  );
}
