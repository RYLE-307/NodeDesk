export function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    menu: 'M3 5h18M3 12h18M3 19h18',
    plus: 'M12 4v16M4 12h16',
    folder: 'M3 6h7l2 3h9v11H3z',
    chevron: 'm9 5 7 7-7 7',
    close: 'm5 5 14 14M5 19 19 5',
    star: 'm12 3 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z',
    more: 'M5 11v2M12 11v2M19 11v2',
    SSH: 'm4 6 6 6-6 6M13 18h7',
    RDP: 'M3 4h18v13H3zM8 21h8M12 17v4',
    VNC: 'M2 5h20v13H2zM5 21h14M12 18v3M7 10h10M7 13h10',
  };
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.folder} /></svg>;
}
