// 公共弹层外壳：统一处理挂载、主题颜色继承、定位翻转、外点 / Esc 关闭，并保证全局只开一个。
// 时间、数值下拉、日期等选择控件共用，保证同类控件的尺寸与行为一致。
const THEME_VARS = [
    '--sdt-card-bg',
    '--sdt-card-border',
    '--sdt-control-bg',
    '--sdt-hover-bg',
    '--sdt-text-primary',
    '--sdt-text-secondary',
    '--sdt-interactive-bg',
    '--sdt-interactive-hover',
    '--background-primary',
    '--background-primary-alt',
    '--background-secondary',
    '--background-modifier-border',
    '--background-modifier-border-hover',
    '--background-modifier-hover',
    '--text-normal',
    '--text-muted',
    '--interactive-accent',
    '--interactive-accent-hover',
    '--text-on-accent',
];

/** 选择器弹层：挂到 body 上，避免被面板 overflow 裁剪 */
export class PickerPopover {
    /** 全局只保留一个打开中的弹层 */
    private static active: PickerPopover | null = null;

    private el: HTMLElement | null = null;

    constructor(
        private readonly triggerEl: HTMLElement,
        private readonly options: { cls: string; onClose?: () => void },
    ) {}

    get isOpen(): boolean {
        return this.el !== null;
    }

    /** 打开弹层并构建内容（构建完成后再定位，保证尺寸准确） */
    open(build: (el: HTMLElement) => void): HTMLElement | null {
        if (this.el) return this.el;
        PickerPopover.active?.close();
        PickerPopover.active = this;

        const el = document.body.createDiv({ cls: `picker-popover ${this.options.cls}`, attr: { role: 'dialog' } });
        this.el = el;
        this.inheritThemeVars(el);
        build(el);
        this.position();

        document.addEventListener('mousedown', this.handleOutside, true);
        document.addEventListener('keydown', this.handleKeydown, true);
        window.addEventListener('resize', this.handleReposition);
        window.addEventListener('scroll', this.handleReposition, true);
        return el;
    }

    /** 收起弹层并移除全局监听 */
    close(): void {
        if (!this.el) return;
        document.removeEventListener('mousedown', this.handleOutside, true);
        document.removeEventListener('keydown', this.handleKeydown, true);
        window.removeEventListener('resize', this.handleReposition);
        window.removeEventListener('scroll', this.handleReposition, true);
        this.el.remove();
        this.el = null;
        if (PickerPopover.active === this) PickerPopover.active = null;
        this.options.onClose?.();
    }

    /** 弹层挂在 body 上，需复制触发器所在主题作用域的颜色变量 */
    private inheritThemeVars(target: HTMLElement): void {
        const styles = getComputedStyle(this.triggerEl);
        for (const name of THEME_VARS) {
            const value = styles.getPropertyValue(name).trim();
            if (value) target.setCssProps({ [name]: value });
        }
    }

    /** 贴近触发器定位，底部空间不足时向上翻转并限制在视口内 */
    private position(): void {
        const popover = this.el;
        if (!popover) return;
        const rect = this.triggerEl.getBoundingClientRect();
        const width = popover.offsetWidth;
        const height = popover.offsetHeight;
        const margin = 8;
        let left = rect.left;
        if (left + width > window.innerWidth - margin) {
            left = Math.max(margin, rect.right - width);
        }
        let top = rect.bottom + 6;
        if (top + height > window.innerHeight - margin) {
            const above = rect.top - 6 - height;
            top = above >= margin ? above : Math.max(margin, window.innerHeight - height - margin);
        }
        popover.setCssStyles({ left: `${Math.round(left)}px`, top: `${Math.round(top)}px` });
    }

    private readonly handleOutside = (evt: MouseEvent): void => {
        const target = evt.target as Node | null;
        if (target && (this.el?.contains(target) || this.triggerEl.contains(target))) return;
        this.close();
    };

    private readonly handleKeydown = (evt: KeyboardEvent): void => {
        if (evt.key !== 'Escape') return;
        evt.preventDefault();
        this.close();
        this.triggerEl.focus();
    };

    private readonly handleReposition = (): void => {
        // 触发器已被移除（如切换任务重建面板）时直接收起，避免浮层残留
        if (!this.triggerEl.isConnected) {
            this.close();
            return;
        }
        this.position();
    };
}
