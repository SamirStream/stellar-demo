

// --- Custom Logo Component ---
export const SignalLogo = ({ className = "w-10 h-10" }: { className?: string }) => (
  <img
    src="/logo.png"
    alt="The Signal Logo"
    className={`${className} object-contain`}
  />
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

    {/* CRT Scanlines — subtle texture */}
    <div className="absolute inset-0 bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.12)_50%)] bg-[length:100%_4px] opacity-25 pointer-events-none"></div>
  </div>
);
