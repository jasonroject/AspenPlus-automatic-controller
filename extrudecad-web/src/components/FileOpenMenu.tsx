import { t } from '../i18n';
import React, { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, FileInput, FileJson, FolderOpen } from 'lucide-react';

interface FileOpenMenuProps {
  onOpenProject: () => void;
  onImportDxf: () => void;
}

export function FileOpenMenu({ onOpenProject, onImportDxf }: FileOpenMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const closeMenu = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outsideClick = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', outsideClick, true);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outsideClick, true);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open]);

  const choose = (action: () => void) => {
    closeMenu(true);
    action();
  };
  const navigateMenu = (event: React.KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = current;
    if (event.key === 'ArrowDown') next = (current + 1) % items.length;
    else if (event.key === 'ArrowUp') next = (current - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else return;
    event.preventDefault();
    items[next]?.focus();
  };

  return <div ref={containerRef} className="file-open-control" onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) closeMenu();
  }}>
    <button ref={triggerRef} type="button" className="quiet-button" aria-label={t("打开文件菜单")} aria-haspopup="menu" aria-expanded={open} aria-controls={menuId}
      title={t("打开工程或导入 DXF 图元")} onClick={() => setOpen((value) => !value)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); setOpen(true); }
      }}><FolderOpen size={15} /><span>{t("打开")}</span><ChevronDown size={11} /></button>
    {t(open && <div id={menuId} ref={menuRef} role="menu" aria-label={t("打开文件方式")} className="file-open-menu" onKeyDown={navigateMenu}>
      <button type="button" role="menuitem" onClick={() => choose(onOpenProject)}><FileJson size={17} /><span><strong>{t("打开工程") + " "}<code>.json</code></strong><small>{t("替换当前场景 · 继续编辑工程")}</small></span></button>
      <button type="button" role="menuitem" onClick={() => choose(onImportDxf)}><FileInput size={17} /><span><strong>{t("导入图元") + " "}<code>.dxf</code></strong><small>{t("追加点、直线与闭合轮廓")}</small></span></button>
    </div>)}
  </div>;
}
