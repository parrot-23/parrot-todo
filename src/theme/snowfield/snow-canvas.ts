// 雪原主题的代码绘制部分：雪地上散布的锥形木帐篷庇护所 + 缓慢飘落的雪花。
// 返回清理函数，视图重绘时需调用以停止动画与监听。
//
// 绘制思路（专业插画）：
// - 帐篷：锥形木结构（斜上方俯视，底面为椭圆弧），灰白木色渐变 + 木板纹理 + 横向木箍，
//   完全不透明，遮住背面。
// - 布局：帐篷数量由主题变量控制，沿画布底部横向均匀分布并带随机抖动，
//   越靠下（越近）的帐篷越大，形成雪原上的远近层次。
// - 雪花：远近层次 + 横向摆动，绘制在帐篷之上，形成前后景深。

/** 单朵雪花：位置、下落速度、半径、摆动相位与透明度 */
interface Snowflake {
    /** 横向位置（像素） */
    x: number;
    /** 纵向位置（像素） */
    y: number;
    /** 下落速度（像素/秒） */
    vy: number;
    /** 半径（像素） */
    r: number;
    /** 横向摆动幅度（像素） */
    sway: number;
    /** 摆动相位 */
    phase: number;
    /** 摆动频率 */
    swaySpeed: number;
    /** 基础透明度 */
    alpha: number;
}

/** 单座帐篷：底边中心位置、高度与顶点横向偏移 */
interface Tent {
    /** 底边中心横坐标（像素） */
    x: number;
    /** 底边中心纵坐标（像素） */
    y: number;
    /** 帐篷高度（像素） */
    h: number;
    /** 顶点相对底边中心的横向偏移（像素） */
    apexOffset: number;
}

/** 设备像素比上限（避免高分屏绘制压力过大） */
const MAX_DPR = 2;
/** 雪花数量上限（变量可调范围的上界） */
const MAX_SNOW = 999;
/** 雪花数量下限 */
const MIN_SNOW = 0;
/** 帐篷数量上限（变量可调范围的上界） */
const MAX_TENTS = 999;
/** 帐篷数量下限 */
const MIN_TENTS = 0;
/** 出场后越过画布边界的额外余量（像素） */
const EDGE_MARGIN = 20;
/** 帐篷高度占画布高度的比例 */
const TENT_HEIGHT_RATIO = 0.34;
/** 帐篷高度上限（像素），避免大屏上帐篷过大 */
const TENT_MAX_HEIGHT = 320;
/** 帐篷高度下限（像素） */
const TENT_MIN_HEIGHT = 90;
/** 帐篷尺寸缩放系数（相对基准尺寸） */
const TENT_SCALE = 0.0625;

function randomBetween(min: number, max: number): number {
    return min + Math.random() * (max - min);
}

/**
 * 在 canvas 上绘制雪原场景：散布的锥形木帐篷 + 飘雪。
 * @param canvas 画布元素
 * @param host 尺寸参照容器
 * @param snowCount 雪花数量（由主题变量传入，超出范围时夹取）
 * @param tentCount 帐篷数量（由主题变量传入，超出范围时夹取）
 * @returns 清理函数
 */
export function createSnowfall(
    canvas: HTMLCanvasElement,
    host: HTMLElement,
    snowCount: number,
    tentCount: number,
): () => void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return () => undefined;

    // 夹取数量到合法范围
    const count = Math.max(MIN_SNOW, Math.min(MAX_SNOW, Math.round(snowCount)));
    const tentsTotal = Math.max(MIN_TENTS, Math.min(MAX_TENTS, Math.round(tentCount)));

    let width = 1;
    let height = 1;
    let flakes: Snowflake[] = [];
    let tents: Tent[] = [];
    let rafId = 0;
    let lastTime = 0;
    let disposed = false;

    /** 生成一朵雪花（fromTop 为 true 时从画布上方进入） */
    const spawn = (fromTop: boolean): Snowflake => {
        // 半径越大越「近」：下落更快、更亮
        const r = randomBetween(0.8, 2.6);
        const depth = (r - 0.8) / 1.8;
        return {
            x: randomBetween(0, width),
            y: fromTop ? randomBetween(-EDGE_MARGIN * 2, -r) : randomBetween(0, height),
            vy: 10 + depth * 26,
            r,
            sway: randomBetween(4, 14) * (0.5 + depth),
            phase: randomBetween(0, Math.PI * 2),
            swaySpeed: randomBetween(0.4, 1.1),
            alpha: 0.35 + depth * 0.5,
        };
    };

    const buildFlakes = (): void => {
        flakes = Array.from({ length: count }, () => spawn(false));
    };

    /**
     * 生成帐篷布局：从山上看下去的雪原，帐篷以画面下方为中心向左右、向上扩散。
     * 分布模型（靶心模型）：
     * - 帐篷优先落在圆心附近，越靠近圆心越拥挤；
     * - 但存在密度上限（最小间距），圆心区域放满后只能逐圈向外放置；
     * - 外圈半径带随机抖动（1~3 个环距），避免边界形成过于规整的圆形轮廓。
     */
    const buildTents = (): void => {
        const baseH = Math.max(TENT_MIN_HEIGHT, Math.min(TENT_MAX_HEIGHT, height * TENT_HEIGHT_RATIO)) * TENT_SCALE;
        // 扩散中心：画面底部中央（观察者所在的山上视角）
        const originX = width / 2;
        const originY = height * 0.98;
        // 纵向压缩：斜视角下雪原在垂直方向被压扁，避免帐篷向上扩散过远
        const verticalSquash = 0.42;
        // 最大扩散半径：覆盖整个画面
        const maxRadius = Math.hypot(width * 0.5, height * 0.85);
        // 密度上限对应的最小间距（相对帐篷尺寸）：小于它就算「放不下」
        const minGap = baseH * 1.95;
        // 环距：相邻两圈的半径差
        const ringStep = minGap * 0.9;

        /** 已放置帐篷的屏幕坐标（用于间距检测） */
        const placed: { x: number; y: number }[] = [];
        /** 判断某点是否与已放置帐篷过近（考虑纵向压缩后的椭圆距离） */
        const tooClose = (x: number, y: number): boolean => {
            for (const p of placed) {
                const dx = x - p.x;
                const dy = (y - p.y) / verticalSquash;
                if (dx * dx + dy * dy < minGap * minGap) return true;
            }
            return false;
        };

        tents = [];
        // 逐圈向外尝试：第 ring 圈半径按 ringStep 递增，圈内均匀取点
        let ring = 0;
        let guard = 0;
        while (tents.length < tentsTotal && guard < 4000) {
            guard += 1;
            // 当前圈基准半径
            const ringRadius = ring * ringStep;
            // 圈内可容纳的点数（周长 / 间距），至少 1 个
            const slots = ring === 0 ? 1 : Math.max(1, Math.floor((Math.PI * 2 * ringRadius) / minGap));
            // 每圈加一点角度偏移，避免各圈点在同一条射线上
            const angleOffset = ring * 0.7;
            for (let i = 0; i < slots && tents.length < tentsTotal; i += 1) {
                const angle = angleOffset + (Math.PI * 2 * i) / slots;
                // 半径抖动：越靠外抖动越大（1~3 个环距），打散规整的圆形边界
                const jitterRings = ring <= 1 ? 0 : randomBetween(0, 2);
                const radius = ringRadius + jitterRings * ringStep;
                // 极坐标 → 屏幕坐标（纵向压缩）
                const x = originX + Math.cos(angle) * radius;
                const y = originY + Math.sin(angle) * radius * verticalSquash;
                // 超出画面或与已放置帐篷过近则跳过（放不下）
                if (x < 0 || x > width || y < 0 || y > height) continue;
                if (tooClose(x, y)) continue;
                // 越靠外（越远）越小：按距圆心的远近做透视缩放
                const depth = Math.min(1, radius / maxRadius);
                const h = baseH * (1.15 - depth * 0.55) * randomBetween(0.9, 1.1);
                placed.push({ x, y });
                tents.push({
                    x: Math.min(width - h * 0.5, Math.max(h * 0.5, x)),
                    y: Math.min(height - h * 0.2, Math.max(h * 1.2, y)),
                    h,
                    apexOffset: h * 1.9 * 0.04,
                });
            }
            ring += 1;
        }
        // 按 y 排序，靠下的（更近）后绘制，形成前后遮挡层次
        tents.sort((a, b) => a.y - b.y);
    };

    const resize = (): void => {
        const rect = host.getBoundingClientRect();
        width = Math.max(1, Math.floor(rect.width));
        height = Math.max(1, Math.floor(rect.height));
        const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        buildFlakes();
        buildTents();
    };

    /** 绘制单座木屋（圆柱底座 + 圆锥屋顶，斜上方俯视视角） */
    const drawTent = (tent: Tent): void => {
        const { x: cx, y: baseY, h: tentH } = tent;
        // 屋顶高度与底座高度：屋顶约占 55%，底座约占 45%
        const roofH = tentH * 0.55;
        const wallH = tentH * 0.45;
        // 底座半径（圆柱），屋顶底边略宽于底座形成屋檐
        const wallR = tentH * 0.62;
        const roofR = wallR * 1.12;
        // 俯视透视：底面是椭圆（近大远小），椭圆短半轴
        const baseRy = wallR * 0.34;
        const wallTopY = baseY - wallH;
        const apexY = wallTopY - roofH;
        // 俯视时顶点略向后（上方）偏移，形成「从山上看下去」的倾斜感
        const apexX = cx + tent.apexOffset;

        // 底座（圆柱）：左右两侧竖向渐变，模拟圆柱受光
        const wallGradient = ctx.createLinearGradient(cx - wallR, 0, cx + wallR, 0);
        wallGradient.addColorStop(0, '#e8e5e0');
        wallGradient.addColorStop(0.35, '#d8d4cd');
        wallGradient.addColorStop(1, '#b0aba2');
        ctx.fillStyle = wallGradient;
        ctx.beginPath();
        // 圆柱侧面：上沿椭圆弧 + 两侧竖线 + 下沿椭圆弧
        ctx.ellipse(cx, wallTopY, wallR, baseRy, 0, Math.PI, 0);
        ctx.lineTo(cx + wallR, baseY);
        ctx.ellipse(cx, baseY, wallR, baseRy, 0, 0, Math.PI);
        ctx.closePath();
        ctx.fill();

        // 底座木板纹理：竖向细线，模拟木墙拼接
        ctx.strokeStyle = 'rgba(140, 134, 126, 0.32)';
        ctx.lineWidth = Math.max(0.5, tentH * 0.004);
        const wallPlanks = 7;
        for (let i = 1; i < wallPlanks; i += 1) {
            const t = i / wallPlanks;
            const x = cx - wallR + wallR * 2 * t;
            // 竖线两端落在上下椭圆弧上
            const dy = baseRy * Math.sqrt(Math.max(0, 1 - (1 - 2 * t) ** 2));
            ctx.beginPath();
            ctx.moveTo(x, wallTopY + dy);
            ctx.lineTo(x, baseY + dy);
            ctx.stroke();
        }

        // 屋顶（圆锥）：灰白渐变（左亮右暗），完全不透明，遮住背面
        const roofGradient = ctx.createLinearGradient(cx - roofR, apexY, cx + roofR, wallTopY);
        roofGradient.addColorStop(0, '#e6e3de');
        roofGradient.addColorStop(0.42, '#d5d1ca');
        roofGradient.addColorStop(1, '#b6b1a8');
        ctx.fillStyle = roofGradient;
        ctx.beginPath();
        ctx.moveTo(apexX, apexY);
        ctx.lineTo(cx + roofR, wallTopY);
        // 屋顶底边用椭圆弧，形成俯视透视
        ctx.ellipse(cx, wallTopY, roofR, baseRy * 1.12, 0, 0, Math.PI);
        ctx.closePath();
        ctx.fill();

        // 屋顶木条纹理：从顶点向底边发散的细线
        ctx.strokeStyle = 'rgba(140, 134, 126, 0.38)';
        ctx.lineWidth = Math.max(0.5, tentH * 0.004);
        const roofPlanks = 9;
        for (let i = 1; i < roofPlanks; i += 1) {
            const t = i / roofPlanks;
            const angle = Math.PI * t;
            const bx = cx + Math.cos(angle) * roofR;
            const by = wallTopY + Math.sin(angle) * baseRy * 1.12;
            ctx.beginPath();
            ctx.moveTo(apexX, apexY);
            ctx.lineTo(bx, by);
            ctx.stroke();
        }

        // 屋顶横向木箍：一道沿锥面弧度的横线
        ctx.strokeStyle = 'rgba(140, 134, 126, 0.3)';
        const bandRatio = 0.55;
        ctx.beginPath();
        ctx.ellipse(
            cx,
            apexY + roofH * bandRatio,
            roofR * bandRatio,
            baseRy * 1.12 * bandRatio,
            0,
            0,
            Math.PI,
        );
        ctx.stroke();

        // 屋顶右侧背光面：叠一层浅灰，强化体积感
        ctx.fillStyle = 'rgba(126, 120, 112, 0.2)';
        ctx.beginPath();
        ctx.moveTo(apexX, apexY);
        ctx.lineTo(cx + roofR, wallTopY);
        ctx.lineTo(cx + roofR * 0.1, wallTopY + baseRy * 0.7);
        ctx.closePath();
        ctx.fill();

        // 屋顶轮廓：浅灰描边，勾出形体
        ctx.strokeStyle = 'rgba(126, 120, 112, 0.72)';
        ctx.lineWidth = Math.max(0.8, tentH * 0.006);
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(apexX, apexY);
        ctx.lineTo(cx + roofR, wallTopY);
        ctx.ellipse(cx, wallTopY, roofR, baseRy * 1.12, 0, 0, Math.PI);
        ctx.closePath();
        ctx.stroke();

        // 底座轮廓：只描下沿椭圆弧与两侧竖线（上沿被屋顶盖住，不描以免透出黑线）
        ctx.beginPath();
        ctx.moveTo(cx - wallR, wallTopY);
        ctx.lineTo(cx - wallR, baseY);
        ctx.ellipse(cx, baseY, wallR, baseRy, 0, Math.PI, 0, true);
        ctx.lineTo(cx + wallR, wallTopY);
        ctx.stroke();
    };

    const update = (delta: number): void => {
        for (const flake of flakes) {
            flake.y += flake.vy * delta;
            flake.phase += flake.swaySpeed * delta;
            // 落出画布底部后从上方重新进入
            if (flake.y - flake.r > height + EDGE_MARGIN) Object.assign(flake, spawn(true));
        }
    };

    const drawFlakes = (): void => {
        for (const flake of flakes) {
            const x = flake.x + Math.sin(flake.phase) * flake.sway;
            // 近纯白：略带极淡冷调，落在近纯白雪面上仍有层次
            ctx.fillStyle = `rgba(255, 255, 255, ${flake.alpha})`;
            ctx.beginPath();
            ctx.arc(x, flake.y, flake.r, 0, Math.PI * 2);
            ctx.fill();
            // 近处雪花加一圈极淡的中性灰描边，避免在近纯白背景上完全消失
            if (flake.r > 1.9) {
                ctx.strokeStyle = `rgba(160, 174, 190, ${flake.alpha * 0.5})`;
                ctx.lineWidth = 0.6;
                ctx.stroke();
            }
        }
    };

    const render = (now: number): void => {
        if (disposed) return;
        const delta = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
        lastTime = now;

        ctx.clearRect(0, 0, width, height);
        update(delta);
        // 先画帐篷（背景），再画雪花（前景），形成前后景深
        for (const tent of tents) drawTent(tent);
        drawFlakes();

        rafId = requestAnimationFrame(render);
    };

    const observer = new ResizeObserver(() => resize());
    observer.observe(host);
    resize();
    rafId = requestAnimationFrame(render);

    return () => {
        disposed = true;
        cancelAnimationFrame(rafId);
        observer.disconnect();
        ctx.clearRect(0, 0, width, height);
    };
}
