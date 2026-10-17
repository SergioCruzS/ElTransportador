/**
 * Componente Raíz de la Aplicación (`app/App.tsx`).
 * Coordina la barra superior, el panel lateral (Colecciones, Entornos, Historial),
 * el área central de edición por pestañas y el visor de respuestas con aislamiento de seguridad.
 */
import React from 'react';
import { ElTransportadorLogo } from '@eltransportador/ui';

export const App: React.FC = () => {
  return (
    <div className="etp-app-shell" data-app="com.eltransportador.desktop">
      <header className="etp-topbar">
        <ElTransportadorLogo size={26} />
        <h1>ElTransportador</h1>
      </header>
    </div>
  );
};
