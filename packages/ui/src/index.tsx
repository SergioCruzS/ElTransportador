/**
 * @eltransportador/ui
 * Componentes visuales reutilizables, accesibles y ligeros con iconografía SVG geométrica bajo demanda.
 */
import React from 'react';

export const ElTransportadorLogo: React.FC<{ size?: number }> = ({ size = 28 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 256 256"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-label="Logotipo de ElTransportador"
  >
    <polygon
      points="74,12 182,12 244,74 244,182 182,244 74,244 12,182 12,74"
      fill="#0B1220"
      stroke="#0EA5E9"
      strokeWidth="10"
    />
    <path d="M52 96 H168 L144 72 L162 54 L212 104 L162 122 L52 122 Z" fill="#06B6D4" />
    <path d="M204 160 H88 L112 184 L94 202 L44 152 L94 134 L204 134 Z" fill="#10B981" />
    <rect x="118" y="118" width="20" height="20" transform="rotate(45 128 128)" fill="#F8FAFC" />
  </svg>
);

export const MethodBadge: React.FC<{ method: string }> = ({ method }) => {
  const m = method.toUpperCase();
  return (
    <span className={`etp-method-badge etp-method-${m.toLowerCase()}`} aria-label={`Método HTTP ${m}`}>
      {m}
    </span>
  );
};
