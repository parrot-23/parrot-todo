// 田园主题的代码绘制部分：Canvas 上绘制简笔风格的田园动物（猫 / 狗 / 鸡 / 鸭 / 鹅 / 牛 / 鸟）在田野中走动。
// 返回清理函数，视图重绘时需调用以停止动画与监听。
//
// 绘制思路（专业简笔插画）：
// - 每种动物用「剪影 + 关键特征」区分：猫（尖耳 + 长尾上翘）、狗（垂耳 + 短尾）、
//   鸡（鸡冠 + 肉垂 + 尾羽）、鸭（扁嘴 + 短颈）、鹅（长颈 + 橙喙 + 白羽）、
//   牛（牛角 + 黑白花斑 + 大身）、鸟（小身 + 翅膀 + 尖喙，空中飞行）。
// - 统一以「脚底中心」为原点、向右为正向绘制，向左时整体镜像。
// - 用不同色系区分物种：猫=橘、狗=棕、鸡=红褐、鸭=青绿、鹅=米白、牛=黑白、鸟=天蓝。

/** 动物类型 */
type AnimalKind = 'cat' | 'dog' | 'chicken' | 'duck' | 'goose' | 'cow' | 'bird';

/** 单只动物：位置、速度、朝向、体型与动画相位 */
interface Animal {
    kind: AnimalKind;
    /** 横向位置（像素） */
    x: number;
    /** 纵向位置（像素，脚底基线） */
    y: number;
    /** 横向速度（像素/秒，正为向右） */
    vx: number;
    /** 体型缩放 */
    scale: number;
    /** 步态动画相位 */
    phase: number;
    /** 步态频率 */
    gait: number;
    /** 是否处于「跳跃」状态（猫狗） */
    hopping: boolean;
    /** 跳跃高度（像素） */
    hopHeight: number;
    /** 跳跃相位 */
    hopPhase: number;
}

/** 设备像素比上限（避免高分屏绘制压力过大） */
const MAX_DPR = 2;
/** 动物数量上限（变量可调范围的上界） */
const MAX_ANIMALS = 999;
/** 动物数量下限 */
const MIN_ANIMALS = 0;
/** 出场后越过画布边界的额外余量（像素） */
const EDGE_MARGIN = 140;

/** 各物种的配色（主色 / 深色描边 / 点缀色） */
const PALETTE: Record<AnimalKind, { body: string; dark: string; accent: string }> = {
    // 猫：橘色虎斑
    cat: { body: '#e8a05a', dark: '#b9763a', accent: '#f6d3a8' },
    // 狗：暖棕
    dog: { body: '#b07a4e', dark: '#7d5232', accent: '#e0c3a0' },
    // 鸡：红褐 + 红冠
    chicken: { body: '#c96a4a', dark: '#8f4630', accent: '#e04b3a' },
    // 鸭：青绿
    duck: { body: '#5f9e8f', dark: '#3d6f63', accent: '#e8b84b' },
    // 鹅：米白 + 橙喙
    goose: { body: '#f2ede2', dark: '#c9bfa8', accent: '#e8913a' },
    // 牛：黑白花斑
    cow: { body: '#f4f1ea', dark: '#3a3630', accent: '#e8a0a0' },
    // 鸟：天蓝
    bird: { body: '#6fa8d6', dark: '#3f6f9a', accent: '#e8b84b' },
};

function randomBetween(min: number, max: number): number {
    return min + Math.random() * (max - min);
}

/** 按权重随机选择物种（猫狗略多，家禽次之，牛较少，鸟适中） */
function pickKind(): AnimalKind {
    const r = Math.random();
    if (r < 0.2) return 'cat';
    if (r < 0.4) return 'dog';
    if (r < 0.54) return 'chicken';
    if (r < 0.68) return 'duck';
    if (r < 0.8) return 'goose';
    if (r < 0.88) return 'cow';
    return 'bird';
}

/**
 * 在 canvas 上绘制田园中走动的动物（简笔风格）。
 * @param canvas 画布元素
 * @param host 尺寸参照容器
 * @param animalCount 动物数量（由主题变量传入，超出范围时夹取）
 * @returns 清理函数
 */
export function createPastoralScene(canvas: HTMLCanvasElement, host: HTMLElement, animalCount: number): () => void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return () => undefined;

    // 夹取动物数量到合法范围
    const count = Math.max(MIN_ANIMALS, Math.min(MAX_ANIMALS, Math.round(animalCount)));

    let width = 1;
    let height = 1;
    let animals: Animal[] = [];
    let rafId = 0;
    let lastTime = 0;
    let disposed = false;

    /** 生成一只动物（随机类型、方向、位置） */
    const spawn = (fromEdge: boolean): Animal => {
        const kind = pickKind();
        const dir = Math.random() < 0.5 ? -1 : 1;
        // 体型：牛最大，家禽略小，鸟最小
        const baseScale = kind === 'cow' ? 1.35
            : kind === 'bird' ? 0.55
                : kind === 'chicken' || kind === 'duck' ? 0.8
                    : kind === 'goose' ? 0.9 : 1;
        const scale = baseScale * randomBetween(0.85, 1.15);
        // 脚底基线：鸟在空中（上方 18% ~ 45%），其余在画布下方 58% ~ 90% 区域
        const y = kind === 'bird'
            ? height * randomBetween(0.18, 0.45)
            : height * randomBetween(0.58, 0.9);
        const x = fromEdge
            ? (dir > 0 ? -EDGE_MARGIN : width + EDGE_MARGIN)
            : randomBetween(0, width);
        // 速度：牛最慢，家禽次之，鸟最快
        const speedBase = kind === 'cow' ? 16
            : kind === 'bird' ? 70
                : kind === 'chicken' || kind === 'duck' || kind === 'goose' ? 22 : 40;
        return {
            kind,
            x,
            y,
            vx: dir * randomBetween(speedBase * 0.7, speedBase * 1.3) * scale,
            scale,
            phase: randomBetween(0, Math.PI * 2),
            gait: randomBetween(6, 10),
            hopping: (kind === 'cat' || kind === 'dog') && Math.random() < 0.3,
            hopHeight: randomBetween(6, 14) * scale,
            hopPhase: randomBetween(0, Math.PI * 2),
        };
    };

    const buildAnimals = (): void => {
        animals = Array.from({ length: count }, () => spawn(false));
    };

    const resize = (): void => {
        const rect = host.getBoundingClientRect();
        width = Math.max(1, Math.floor(rect.width));
        height = Math.max(1, Math.floor(rect.height));
        const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        buildAnimals();
    };

    /** 绘制椭圆填充 */
    const ellipse = (cx: number, cy: number, rx: number, ry: number, rot = 0): void => {
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2);
        ctx.fill();
    };

    /** 绘制圆点 */
    const dot = (cx: number, cy: number, r: number): void => {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
    };

    /** 绘制猫：尖耳、长尾上翘、四足 */
    const drawCat = (a: Animal, legSwing: number): void => {
        const p = PALETTE.cat;
        const bodyW = 30;
        const bodyH = 16;
        const legLen = 10;
        const bodyCy = -legLen - bodyH * 0.5;

        // 腿
        ctx.strokeStyle = p.dark;
        ctx.lineWidth = 2.4;
        ctx.lineCap = 'round';
        [-0.34, -0.14, 0.14, 0.34].forEach((f, i) => {
            const swing = Math.sin(a.phase + i * Math.PI * 0.5) * legSwing * 4;
            ctx.beginPath();
            ctx.moveTo(bodyW * f, bodyCy + bodyH * 0.4);
            ctx.lineTo(bodyW * f + swing, 0);
            ctx.stroke();
        });

        // 尾巴：从臀部向上翘起并弯曲
        ctx.strokeStyle = p.body;
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        ctx.moveTo(-bodyW * 0.48, bodyCy);
        ctx.quadraticCurveTo(-bodyW * 0.95, bodyCy - 6, -bodyW * 0.7, bodyCy - 26);
        ctx.stroke();

        // 身体
        ctx.fillStyle = p.body;
        ellipse(0, bodyCy, bodyW * 0.5, bodyH * 0.5);

        // 头部（前端偏上）
        const headX = bodyW * 0.46;
        const headY = bodyCy - bodyH * 0.42;
        const headR = 9;
        ellipse(headX, headY, headR, headR * 0.92);

        // 尖耳（两个三角）
        ctx.beginPath();
        ctx.moveTo(headX - headR * 0.55, headY - headR * 0.55);
        ctx.lineTo(headX - headR * 0.15, headY - headR * 1.55);
        ctx.lineTo(headX + headR * 0.25, headY - headR * 0.7);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(headX + headR * 0.15, headY - headR * 0.7);
        ctx.lineTo(headX + headR * 0.55, headY - headR * 1.5);
        ctx.lineTo(headX + headR * 0.9, headY - headR * 0.45);
        ctx.closePath();
        ctx.fill();

        // 眼睛
        ctx.fillStyle = p.dark;
        dot(headX + headR * 0.35, headY - headR * 0.05, 1.4);
        // 胡须
        ctx.strokeStyle = p.dark;
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        ctx.moveTo(headX + headR * 0.7, headY + headR * 0.25);
        ctx.lineTo(headX + headR * 1.5, headY + headR * 0.1);
        ctx.moveTo(headX + headR * 0.7, headY + headR * 0.4);
        ctx.lineTo(headX + headR * 1.5, headY + headR * 0.5);
        ctx.stroke();
    };

    /** 绘制狗：垂耳、短尾、四足 */
    const drawDog = (a: Animal, legSwing: number): void => {
        const p = PALETTE.dog;
        const bodyW = 34;
        const bodyH = 18;
        const legLen = 11;
        const bodyCy = -legLen - bodyH * 0.5;

        // 腿
        ctx.strokeStyle = p.dark;
        ctx.lineWidth = 2.8;
        ctx.lineCap = 'round';
        [-0.34, -0.14, 0.14, 0.34].forEach((f, i) => {
            const swing = Math.sin(a.phase + i * Math.PI * 0.5) * legSwing * 4;
            ctx.beginPath();
            ctx.moveTo(bodyW * f, bodyCy + bodyH * 0.4);
            ctx.lineTo(bodyW * f + swing, 0);
            ctx.stroke();
        });

        // 短尾（上翘小三角）
        ctx.fillStyle = p.body;
        ctx.beginPath();
        ctx.moveTo(-bodyW * 0.48, bodyCy - 2);
        ctx.lineTo(-bodyW * 0.72, bodyCy - 12);
        ctx.lineTo(-bodyW * 0.4, bodyCy - 6);
        ctx.closePath();
        ctx.fill();

        // 身体
        ellipse(0, bodyCy, bodyW * 0.5, bodyH * 0.5);

        // 头部
        const headX = bodyW * 0.48;
        const headY = bodyCy - bodyH * 0.4;
        const headR = 10;
        ellipse(headX, headY, headR, headR * 0.95);

        // 口鼻（前端突出）
        ctx.fillStyle = p.accent;
        ellipse(headX + headR * 0.75, headY + headR * 0.25, headR * 0.5, headR * 0.38);

        // 垂耳（两侧下垂椭圆）
        ctx.fillStyle = p.dark;
        ellipse(headX - headR * 0.55, headY + headR * 0.15, headR * 0.32, headR * 0.72, 0.35);
        ellipse(headX + headR * 0.35, headY + headR * 0.1, headR * 0.3, headR * 0.68, -0.3);

        // 眼睛 + 鼻头
        ctx.fillStyle = p.dark;
        dot(headX + headR * 0.3, headY - headR * 0.1, 1.5);
        dot(headX + headR * 1.05, headY + headR * 0.2, 1.6);
    };

    /** 绘制鸡：鸡冠、肉垂、尾羽、细腿 */
    const drawChicken = (a: Animal, legSwing: number): void => {
        const p = PALETTE.chicken;
        const bodyW = 24;
        const bodyH = 20;
        const legLen = 9;
        const bodyCy = -legLen - bodyH * 0.5;

        // 细腿
        ctx.strokeStyle = p.accent;
        ctx.lineWidth = 1.8;
        ctx.lineCap = 'round';
        [-0.12, 0.12].forEach((f, i) => {
            const swing = Math.sin(a.phase + i * Math.PI) * legSwing * 3;
            ctx.beginPath();
            ctx.moveTo(bodyW * f, bodyCy + bodyH * 0.4);
            ctx.lineTo(bodyW * f + swing, 0);
            ctx.stroke();
        });

        // 尾羽（后方扇形）
        ctx.fillStyle = p.dark;
        ctx.beginPath();
        ctx.moveTo(-bodyW * 0.4, bodyCy);
        ctx.quadraticCurveTo(-bodyW * 0.95, bodyCy - 14, -bodyW * 0.55, bodyCy - 20);
        ctx.quadraticCurveTo(-bodyW * 0.5, bodyCy - 8, -bodyW * 0.3, bodyCy - 4);
        ctx.closePath();
        ctx.fill();

        // 身体（蛋形）
        ctx.fillStyle = p.body;
        ellipse(0, bodyCy, bodyW * 0.5, bodyH * 0.5);

        // 头
        const headX = bodyW * 0.42;
        const headY = bodyCy - bodyH * 0.5;
        const headR = 7.5;
        ellipse(headX, headY, headR, headR);

        // 鸡冠（头顶红色锯齿）
        ctx.fillStyle = p.accent;
        ctx.beginPath();
        ctx.moveTo(headX - headR * 0.6, headY - headR * 0.7);
        ctx.lineTo(headX - headR * 0.3, headY - headR * 1.5);
        ctx.lineTo(headX, headY - headR * 0.85);
        ctx.lineTo(headX + headR * 0.3, headY - headR * 1.55);
        ctx.lineTo(headX + headR * 0.6, headY - headR * 0.7);
        ctx.closePath();
        ctx.fill();

        // 肉垂（喙下红色）
        ctx.beginPath();
        ctx.moveTo(headX + headR * 0.7, headY + headR * 0.3);
        ctx.quadraticCurveTo(headX + headR * 0.9, headY + headR * 1.1, headX + headR * 0.5, headY + headR * 0.9);
        ctx.closePath();
        ctx.fill();

        // 喙（黄色三角）
        ctx.fillStyle = '#e8b84b';
        ctx.beginPath();
        ctx.moveTo(headX + headR * 0.85, headY + headR * 0.05);
        ctx.lineTo(headX + headR * 1.6, headY + headR * 0.25);
        ctx.lineTo(headX + headR * 0.85, headY + headR * 0.45);
        ctx.closePath();
        ctx.fill();

        // 眼睛
        ctx.fillStyle = p.dark;
        dot(headX + headR * 0.35, headY - headR * 0.1, 1.3);
    };

    /** 绘制鸭：扁嘴、短颈、圆身 */
    const drawDuck = (a: Animal, legSwing: number): void => {
        const p = PALETTE.duck;
        const bodyW = 26;
        const bodyH = 17;
        const legLen = 7;
        const bodyCy = -legLen - bodyH * 0.5;

        // 短腿
        ctx.strokeStyle = p.accent;
        ctx.lineWidth = 1.8;
        ctx.lineCap = 'round';
        [-0.1, 0.1].forEach((f, i) => {
            const swing = Math.sin(a.phase + i * Math.PI) * legSwing * 3;
            ctx.beginPath();
            ctx.moveTo(bodyW * f, bodyCy + bodyH * 0.4);
            ctx.lineTo(bodyW * f + swing, 0);
            ctx.stroke();
        });

        // 身体（圆润）
        ctx.fillStyle = p.body;
        ellipse(0, bodyCy, bodyW * 0.5, bodyH * 0.5);

        // 短颈 + 头
        const headX = bodyW * 0.4;
        const headY = bodyCy - bodyH * 0.55;
        const headR = 7;
        ctx.strokeStyle = p.body;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(bodyW * 0.28, bodyCy - bodyH * 0.2);
        ctx.lineTo(headX, headY + headR * 0.4);
        ctx.stroke();
        ctx.fillStyle = p.body;
        ellipse(headX, headY, headR, headR);

        // 扁嘴（橙色扁椭圆）
        ctx.fillStyle = p.accent;
        ellipse(headX + headR * 1.05, headY + headR * 0.2, headR * 0.75, headR * 0.32);

        // 眼睛
        ctx.fillStyle = p.dark;
        dot(headX + headR * 0.3, headY - headR * 0.15, 1.3);
    };

    /** 绘制鹅：长颈、橙喙、白羽、体型较大 */
    const drawGoose = (a: Animal, legSwing: number): void => {
        const p = PALETTE.goose;
        const bodyW = 30;
        const bodyH = 18;
        const legLen = 9;
        const bodyCy = -legLen - bodyH * 0.5;

        // 腿
        ctx.strokeStyle = p.accent;
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        [-0.1, 0.1].forEach((f, i) => {
            const swing = Math.sin(a.phase + i * Math.PI) * legSwing * 3;
            ctx.beginPath();
            ctx.moveTo(bodyW * f, bodyCy + bodyH * 0.4);
            ctx.lineTo(bodyW * f + swing, 0);
            ctx.stroke();
        });

        // 身体
        ctx.fillStyle = p.body;
        ellipse(0, bodyCy, bodyW * 0.5, bodyH * 0.5);

        // 长颈（S 形）
        const headX = bodyW * 0.5;
        const headY = bodyCy - bodyH * 1.5;
        ctx.strokeStyle = p.body;
        ctx.lineWidth = 6.5;
        ctx.beginPath();
        ctx.moveTo(bodyW * 0.3, bodyCy - bodyH * 0.2);
        ctx.quadraticCurveTo(bodyW * 0.62, bodyCy - bodyH * 0.9, headX, headY + 4);
        ctx.stroke();

        // 头
        const headR = 6.5;
        ctx.fillStyle = p.body;
        ellipse(headX, headY, headR, headR * 0.95);

        // 橙喙
        ctx.fillStyle = p.accent;
        ctx.beginPath();
        ctx.moveTo(headX + headR * 0.7, headY - headR * 0.1);
        ctx.lineTo(headX + headR * 1.9, headY + headR * 0.15);
        ctx.lineTo(headX + headR * 0.7, headY + headR * 0.45);
        ctx.closePath();
        ctx.fill();

        // 眼睛
        ctx.fillStyle = p.dark;
        dot(headX + headR * 0.3, headY - headR * 0.2, 1.2);
    };

    /** 绘制牛：牛角、黑白花斑、大身、四足 */
    const drawCow = (a: Animal, legSwing: number): void => {
        const p = PALETTE.cow;
        const bodyW = 44;
        const bodyH = 24;
        const legLen = 13;
        const bodyCy = -legLen - bodyH * 0.5;

        // 腿（粗壮）
        ctx.strokeStyle = p.dark;
        ctx.lineWidth = 3.6;
        ctx.lineCap = 'round';
        [-0.34, -0.14, 0.14, 0.34].forEach((f, i) => {
            const swing = Math.sin(a.phase + i * Math.PI * 0.5) * legSwing * 4;
            ctx.beginPath();
            ctx.moveTo(bodyW * f, bodyCy + bodyH * 0.4);
            ctx.lineTo(bodyW * f + swing, 0);
            ctx.stroke();
        });

        // 尾巴（细长下垂，末端毛球）
        ctx.strokeStyle = p.dark;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(-bodyW * 0.48, bodyCy - 2);
        ctx.quadraticCurveTo(-bodyW * 0.62, bodyCy + 8, -bodyW * 0.55, bodyCy + 16);
        ctx.stroke();
        ctx.fillStyle = p.dark;
        dot(-bodyW * 0.55, bodyCy + 17, 2.2);

        // 身体（大椭圆）
        ctx.fillStyle = p.body;
        ellipse(0, bodyCy, bodyW * 0.5, bodyH * 0.5);

        // 黑白花斑（几块深色斑）
        ctx.fillStyle = p.dark;
        ellipse(-bodyW * 0.18, bodyCy - bodyH * 0.12, bodyW * 0.14, bodyH * 0.22, 0.3);
        ellipse(bodyW * 0.12, bodyCy + bodyH * 0.1, bodyW * 0.1, bodyH * 0.16, -0.2);

        // 头（前端，略低）
        const headX = bodyW * 0.5;
        const headY = bodyCy - bodyH * 0.15;
        const headR = 11;
        ellipse(headX, headY, headR, headR * 0.9);

        // 口鼻（前端浅色）
        ctx.fillStyle = p.accent;
        ellipse(headX + headR * 0.7, headY + headR * 0.35, headR * 0.55, headR * 0.42);

        // 牛角（头顶两侧弯角）
        ctx.strokeStyle = '#d9c9a8';
        ctx.lineWidth = 2.6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(headX - headR * 0.5, headY - headR * 0.6);
        ctx.quadraticCurveTo(headX - headR * 0.9, headY - headR * 1.2, headX - headR * 0.5, headY - headR * 1.35);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(headX + headR * 0.3, headY - headR * 0.7);
        ctx.quadraticCurveTo(headX + headR * 0.7, headY - headR * 1.3, headX + headR * 1.05, headY - headR * 1.1);
        ctx.stroke();

        // 耳朵
        ctx.fillStyle = p.dark;
        ellipse(headX - headR * 0.75, headY - headR * 0.1, headR * 0.3, headR * 0.18, 0.4);

        // 眼睛 + 鼻孔
        ctx.fillStyle = p.dark;
        dot(headX + headR * 0.35, headY - headR * 0.15, 1.6);
        dot(headX + headR * 0.95, headY + headR * 0.3, 1.1);
    };

    /** 绘制鸟：小身、翅膀、尖喙，空中飞行（翅膀随相位扇动） */
    const drawBird = (a: Animal, legSwing: number): void => {
        const p = PALETTE.bird;
        const bodyW = 20;
        const bodyH = 12;
        const bodyCy = 0;

        // 翅膀扇动：用相位驱动上下摆动
        const flap = Math.sin(a.phase * 1.6) * 0.6;

        // 尾羽（后方小三角）
        ctx.fillStyle = p.dark;
        ctx.beginPath();
        ctx.moveTo(-bodyW * 0.45, bodyCy);
        ctx.lineTo(-bodyW * 0.85, bodyCy - 4);
        ctx.lineTo(-bodyW * 0.85, bodyCy + 4);
        ctx.closePath();
        ctx.fill();

        // 身体（流线椭圆）
        ctx.fillStyle = p.body;
        ellipse(0, bodyCy, bodyW * 0.5, bodyH * 0.5);

        // 翅膀（身体上方，随扇动上下）
        ctx.fillStyle = p.dark;
        ctx.beginPath();
        ctx.moveTo(-bodyW * 0.1, bodyCy - bodyH * 0.2);
        ctx.quadraticCurveTo(
            -bodyW * 0.05, bodyCy - bodyH * 0.9 - flap * 8,
            bodyW * 0.35, bodyCy - bodyH * 0.3 - flap * 4,
        );
        ctx.quadraticCurveTo(bodyW * 0.1, bodyCy - bodyH * 0.1, -bodyW * 0.1, bodyCy - bodyH * 0.2);
        ctx.closePath();
        ctx.fill();

        // 头
        const headX = bodyW * 0.5;
        const headY = bodyCy - bodyH * 0.25;
        const headR = 6;
        ctx.fillStyle = p.body;
        ellipse(headX, headY, headR, headR);

        // 尖喙（橙色小三角）
        ctx.fillStyle = p.accent;
        ctx.beginPath();
        ctx.moveTo(headX + headR * 0.7, headY - headR * 0.1);
        ctx.lineTo(headX + headR * 1.7, headY + headR * 0.15);
        ctx.lineTo(headX + headR * 0.7, headY + headR * 0.4);
        ctx.closePath();
        ctx.fill();

        // 眼睛
        ctx.fillStyle = p.dark;
        dot(headX + headR * 0.3, headY - headR * 0.15, 1.2);
    };

    /** 绘制一只动物（以脚底中心为原点，向右为正向，向左时整体镜像） */
    const drawAnimal = (a: Animal): void => {
        const legSwing = Math.sin(a.phase) * 0.5;
        const hop = a.hopping ? Math.abs(Math.sin(a.hopPhase)) * a.hopHeight : 0;

        ctx.save();
        ctx.translate(a.x, a.y - hop);
        if (a.vx < 0) ctx.scale(-1, 1);
        ctx.scale(a.scale, a.scale);
        ctx.lineJoin = 'round';

        switch (a.kind) {
            case 'cat': drawCat(a, legSwing); break;
            case 'dog': drawDog(a, legSwing); break;
            case 'chicken': drawChicken(a, legSwing); break;
            case 'duck': drawDuck(a, legSwing); break;
            case 'goose': drawGoose(a, legSwing); break;
            case 'cow': drawCow(a, legSwing); break;
            case 'bird': drawBird(a, legSwing); break;
        }

        ctx.restore();
    };

    const update = (delta: number): void => {
        for (const a of animals) {
            a.x += a.vx * delta;
            a.phase += a.gait * delta;
            if (a.hopping) a.hopPhase += a.gait * 0.6 * delta;

            // 越过边界后从另一侧重新进入
            if (a.vx > 0 && a.x > width + EDGE_MARGIN) {
                Object.assign(a, spawn(true));
                a.x = -EDGE_MARGIN;
                a.vx = Math.abs(a.vx);
            } else if (a.vx < 0 && a.x < -EDGE_MARGIN) {
                Object.assign(a, spawn(true));
                a.x = width + EDGE_MARGIN;
                a.vx = -Math.abs(a.vx);
            }
        }
    };

    const render = (now: number): void => {
        if (disposed) return;
        const delta = lastTime ? Math.min(0.05, (now - lastTime) / 1000) : 0;
        lastTime = now;

        ctx.clearRect(0, 0, width, height);
        update(delta);
        // 按 y 排序，靠下的（更近）后绘制，形成前后遮挡层次
        const sorted = [...animals].sort((a, b) => a.y - b.y);
        for (const a of sorted) drawAnimal(a);

        rafId = window.requestAnimationFrame(render);
    };

    const observer = new ResizeObserver(() => resize());
    observer.observe(host);
    resize();
    rafId = window.requestAnimationFrame(render);

    return () => {
        disposed = true;
        cancelAnimationFrame(rafId);
        observer.disconnect();
        ctx.clearRect(0, 0, width, height);
    };
}
