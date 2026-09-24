import React from 'react';

export default function CloudGuardLogo({ size = 120, className = '' }) {
  return (
    <img 
      src="/cloudguard-logo.svg" 
      alt="CloudGuard Logo" 
      width={size} 
      height={size} 
      className={className}
      style={{ objectFit: 'contain' }}
    />
  );
}
