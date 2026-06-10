// Mini-ilustrações SVG para guiar a instalação da extensão.
// São desenhos estilizados (não screenshots reais), com textos legíveis.

const Frame = ({ children, label }: { children: React.ReactNode; label?: string }) => (
  <div className="rounded-md border bg-muted/30 p-3">
    <svg viewBox="0 0 400 200" className="w-full h-auto" xmlns="http://www.w3.org/2000/svg">
      {children}
    </svg>
    {label && <p className="text-[11px] text-center text-muted-foreground mt-1">{label}</p>}
  </div>
);

export const UnzipIllustration = () => (
  <Frame label="Clique com o botão direito no arquivo e escolha 'Extrair'">
    <rect x="0" y="0" width="400" height="200" fill="#f8fafc" rx="6" />
    {/* ZIP file icon */}
    <g transform="translate(40,60)">
      <rect x="0" y="0" width="60" height="72" rx="4" fill="#fbbf24" stroke="#d97706" />
      <rect x="22" y="0" width="16" height="32" fill="#d97706" />
      <text x="30" y="60" textAnchor="middle" fontSize="10" fill="#78350f" fontWeight="bold">ZIP</text>
    </g>
    <text x="70" y="155" textAnchor="middle" fontSize="9" fill="#475569">monitor-extension.zip</text>
    {/* Arrow */}
    <g stroke="#1e40af" strokeWidth="2" fill="none">
      <path d="M 115 95 L 165 95" markerEnd="url(#arrow)" />
    </g>
    <defs>
      <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
        <polygon points="0 0, 8 4, 0 8" fill="#1e40af" />
      </marker>
    </defs>
    {/* Context menu */}
    <g transform="translate(175,40)">
      <rect width="160" height="120" rx="6" fill="#fff" stroke="#cbd5e1" />
      <rect y="8" width="160" height="20" fill="transparent" />
      <text x="12" y="22" fontSize="11" fill="#0f172a">Abrir</text>
      <line x1="8" x2="152" y1="34" y2="34" stroke="#e2e8f0" />
      <rect x="4" y="40" width="152" height="22" rx="3" fill="#dbeafe" />
      <text x="12" y="55" fontSize="11" fill="#1e3a8a" fontWeight="600">Extrair tudo…</text>
      <text x="12" y="78" fontSize="11" fill="#0f172a">Copiar</text>
      <text x="12" y="98" fontSize="11" fill="#0f172a">Renomear</text>
      <text x="12" y="116" fontSize="11" fill="#0f172a">Propriedades</text>
    </g>
  </Frame>
);

export const ChromeUrlIllustration = () => (
  <Frame label="Cole na barra de endereço e pressione Enter">
    <rect x="0" y="0" width="400" height="200" fill="#f8fafc" rx="6" />
    {/* Browser window */}
    <rect x="20" y="20" width="360" height="160" rx="8" fill="#fff" stroke="#cbd5e1" />
    {/* Top bar */}
    <rect x="20" y="20" width="360" height="34" rx="8" fill="#e2e8f0" />
    <circle cx="36" cy="37" r="5" fill="#ef4444" />
    <circle cx="52" cy="37" r="5" fill="#f59e0b" />
    <circle cx="68" cy="37" r="5" fill="#22c55e" />
    {/* Tab */}
    <path d="M 90 54 L 100 30 L 200 30 L 210 54 Z" fill="#fff" />
    <text x="150" y="46" textAnchor="middle" fontSize="10" fill="#475569">Nova guia</text>
    {/* URL bar */}
    <rect x="40" y="66" width="320" height="28" rx="14" fill="#f1f5f9" stroke="#3b82f6" strokeWidth="2" />
    <text x="56" y="84" fontSize="12" fill="#1e40af" fontFamily="monospace" fontWeight="600">chrome://extensions</text>
    {/* Cursor */}
    <rect x="208" y="72" width="1.5" height="16" fill="#1e40af">
      <animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite" />
    </rect>
    {/* Hint */}
    <text x="200" y="140" textAnchor="middle" fontSize="11" fill="#64748b">↑ Cole aqui e pressione Enter</text>
  </Frame>
);

export const DevModeIllustration = () => (
  <Frame label="Ative o 'Modo do desenvolvedor' e clique em 'Carregar sem compactação'">
    <rect x="0" y="0" width="400" height="200" fill="#f8fafc" rx="6" />
    <rect x="20" y="20" width="360" height="160" rx="6" fill="#fff" stroke="#cbd5e1" />
    {/* Header bar */}
    <text x="36" y="48" fontSize="13" fill="#0f172a" fontWeight="700">Extensões</text>
    {/* Dev mode toggle (right side) */}
    <text x="240" y="48" fontSize="10" fill="#475569">Modo do desenvolvedor</text>
    <rect x="345" y="38" width="26" height="14" rx="7" fill="#3b82f6" />
    <circle cx="364" cy="45" r="6" fill="#fff" />
    {/* Red circle highlight on toggle */}
    <circle cx="358" cy="45" r="16" fill="none" stroke="#ef4444" strokeWidth="2" strokeDasharray="3,2" />
    {/* Action buttons row */}
    <g transform="translate(36,72)">
      <rect width="120" height="30" rx="4" fill="#dbeafe" stroke="#3b82f6" strokeWidth="2" />
      <text x="60" y="20" textAnchor="middle" fontSize="11" fill="#1e3a8a" fontWeight="600">Carregar sem compactação</text>
      <rect x="130" y="0" width="90" height="30" rx="4" fill="#f1f5f9" stroke="#cbd5e1" />
      <text x="175" y="20" textAnchor="middle" fontSize="10" fill="#475569">Empacotar</text>
      <rect x="230" y="0" width="70" height="30" rx="4" fill="#f1f5f9" stroke="#cbd5e1" />
      <text x="265" y="20" textAnchor="middle" fontSize="10" fill="#475569">Atualizar</text>
    </g>
    {/* Red arrow to the button */}
    <path d="M 60 140 L 80 115" stroke="#ef4444" strokeWidth="2" fill="none" markerEnd="url(#arrow2)" />
    <text x="60" y="160" textAnchor="middle" fontSize="10" fill="#ef4444" fontWeight="600">Clique aqui</text>
    <defs>
      <marker id="arrow2" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
        <polygon points="0 0, 8 4, 0 8" fill="#ef4444" />
      </marker>
    </defs>
  </Frame>
);

export const SelectFolderIllustration = () => (
  <Frame label="Selecione a PASTA descompactada (não o arquivo .zip)">
    <rect x="0" y="0" width="400" height="200" fill="#f8fafc" rx="6" />
    <rect x="20" y="20" width="360" height="160" rx="6" fill="#fff" stroke="#cbd5e1" />
    <rect x="20" y="20" width="360" height="24" rx="6" fill="#e2e8f0" />
    <text x="200" y="37" textAnchor="middle" fontSize="11" fill="#0f172a" fontWeight="600">Selecione o diretório da extensão</text>
    {/* File list */}
    <g transform="translate(36,58)">
      {/* Folder - highlighted */}
      <rect width="328" height="28" rx="4" fill="#dbeafe" stroke="#3b82f6" strokeWidth="2" />
      <path d="M 10 14 L 18 8 L 28 8 L 30 12 L 42 12 L 42 22 L 10 22 Z" fill="#3b82f6" />
      <text x="52" y="20" fontSize="11" fill="#1e3a8a" fontWeight="600">monitor-extension</text>
      <text x="280" y="20" fontSize="9" fill="#64748b">Pasta</text>
      {/* ZIP - greyed out */}
      <g transform="translate(0,34)" opacity="0.4">
        <rect width="328" height="24" rx="4" fill="#f1f5f9" />
        <rect x="10" y="6" width="14" height="14" rx="2" fill="#fbbf24" />
        <text x="52" y="18" fontSize="11" fill="#94a3b8">monitor-extension.zip</text>
        <text x="280" y="18" fontSize="9" fill="#94a3b8">(não aparece)</text>
      </g>
    </g>
    {/* Buttons */}
    <g transform="translate(220,148)">
      <rect width="70" height="24" rx="4" fill="#f1f5f9" stroke="#cbd5e1" />
      <text x="35" y="16" textAnchor="middle" fontSize="10" fill="#475569">Cancelar</text>
      <rect x="78" y="0" width="70" height="24" rx="4" fill="#3b82f6" />
      <text x="113" y="16" textAnchor="middle" fontSize="10" fill="#fff" fontWeight="600">Selecionar</text>
    </g>
  </Frame>
);
