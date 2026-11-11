export const loadCashfree = async () => {
  if (typeof window.Cashfree === 'function') {
    return window.Cashfree({ mode: 'sandbox' });
  }
  throw new Error('Cashfree SDK is not loaded. Please refresh and try again.');
};

