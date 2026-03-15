import React from 'react';
import type { LucideIcon } from 'lucide-react';

export const Card = ({ children, className = '', hoverEffect = false, glowOnHover = false, onClick }: { children: React.ReactNode, className?: string, hoverEffect?: boolean, glowOnHover?: boolean, onClick?: React.MouseEventHandler<HTMLDivElement> }) => (
  <div onClick={onClick} className={`relative group bg-[#09090b]/80 backdrop-blur-2xl border border-zinc-800/60 rounded-3xl shadow-2xl transition-all duration-500 overflow-hidden ${hoverEffect ? 'hover:-translate-y-1' : ''} ${className}`}>
    {glowOnHover && (
      <div className="absolute -inset-0.5 bg-gradient-to-r from-emerald-500 to-green-400 rounded-3xl opacity-0 group-hover:opacity-20 transition duration-500 blur"></div>
    )}
    <div className="relative z-10 h-full">
      {children}
    </div>
  </div>
);

type ButtonProps = {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  className?: string;
  icon?: LucideIcon;
  disabled?: boolean;
};

export const Button = ({ children, onClick, variant = 'primary', className = '', icon: Icon, disabled = false }: ButtonProps) => {
  const baseStyle = "relative flex items-center justify-center gap-2 px-6 py-3.5 rounded-xl font-bold transition-all duration-300 transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden group";
  
  const variants = {
    primary: "bg-emerald-500 text-[#02040a] shadow-[0_0_20px_rgba(16,185,129,0.3)] hover:shadow-[0_0_35px_rgba(16,185,129,0.5)]",
    secondary: "bg-zinc-900/80 text-emerald-400 border border-emerald-500/20 hover:border-emerald-500/60 hover:bg-zinc-800",
    danger: "bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500/20 hover:shadow-[0_0_20px_rgba(239,68,68,0.2)]",
    ghost: "bg-transparent text-zinc-400 hover:text-white hover:bg-zinc-900"
  };

  return (
    <button onClick={onClick} disabled={disabled} className={`${baseStyle} ${variants[variant]} ${className}`}>
      {variant === 'primary' && (
        <span className="absolute inset-0 w-full h-full -translate-x-full bg-gradient-to-r from-transparent via-white/40 to-transparent group-hover:animate-shimmer"></span>
      )}
      <span className="relative flex items-center gap-2">
        {Icon && <Icon size={18} className={variant === 'primary' ? 'text-[#02040a]' : ''} />}
        {children}
      </span>
    </button>
  );
};

export const Tag = ({ children, color = 'emerald', className = '' }: { children: React.ReactNode, color?: 'emerald' | 'zinc' | 'amber' | 'red' | 'blue', className?: string }) => {
  const colors = {
    emerald: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.1)]',
    zinc: 'bg-zinc-800/50 border-zinc-700 text-zinc-300',
    amber: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
    red: 'bg-red-500/10 border-red-500/30 text-red-400 shadow-[0_0_10px_rgba(239,68,68,0.1)]',
    blue: 'bg-blue-500/10 border-blue-500/30 text-blue-400'
  };
  return (
    <span className={`px-3 py-1 text-[10px] uppercase tracking-[0.2em] font-extrabold rounded-full border ${colors[color]} ${className}`}>
      {children}
    </span>
  );
};
