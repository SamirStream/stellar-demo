

// --- Custom Logo Component ---
export const SignalLogo = ({ className = "w-10 h-10" }: { className?: string }) => (
  // The user requested to reuse their existing logo or the one provided. This matches the provided SVG in the prompt.
  <svg 
    viewBox="0 0 100 100" 
    className={`${className} drop-shadow-[0_0_15px_rgba(74,222,128,0.8)]`} 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
  >
    <path d="M 15 85 L 15 65 L 30 50 L 30 85 Z" fill="#4ade80" />
    <path d="M 37 85 L 37 65 L 52 50 L 52 85 Z" fill="#4ade80" />
    <path d="M 37 55 L 37 45 L 52 30 L 52 55 Z" fill="#4ade80" />
    <path d="M 59 85 L 59 65 L 74 50 L 74 85 Z" fill="#4ade80" />
    <path d="M 59 55 L 59 25 L 74 10 L 74 55 Z" fill="#4ade80" />
    <path d="M 81 85 L 81 15 L 96 0 L 96 85 Z" fill="#4ade80" />
  </svg>
);

// --- High-End UI Components ---
export const GlowingBackground = () => (
  <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
    {/* Deep Space Black */}
    <div className="absolute inset-0 bg-[#02040a]"></div>
    
    {/* Architectural Grid */}
    <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:40px_40px] [mask-image:radial-gradient(ellipse_80%_80%_at_50%_0%,#000_70%,transparent_100%)]"></div>
    
    {/* Neon Orbs */}
    <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-emerald-900/20 blur-[150px] animate-pulse-slow"></div>
    <div className="absolute top-[20%] right-[-20%] w-[50%] h-[50%] rounded-full bg-green-900/10 blur-[120px]"></div>
  </div>
);
