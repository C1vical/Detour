import { NavigationIcon } from "./icons";

export default function Header() {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/10 bg-slate-950 px-4 text-white sm:px-6">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-sky-500 shadow-lg shadow-emerald-500/20">
          <NavigationIcon className="size-4.5 text-slate-950" />
        </span>
        <div className="leading-tight">
          <p className="text-[17px] font-semibold tracking-tight">
            Context<span className="text-emerald-400">Route</span>
          </p>
          <p className="hidden text-xs text-slate-400 sm:block">The best route for you, right now.</p>
        </div>
      </div>
      <div className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 py-1 pr-3 pl-1.5 text-xs text-slate-300">
        <span className="rounded-full bg-[#e31837] px-2 py-0.5 text-[10px] font-bold tracking-wider text-white">YORK U</span>
        <span className="hidden sm:inline">Keele Campus · Live demo</span>
        <span className="relative flex size-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-400" />
        </span>
      </div>
    </header>
  );
}
