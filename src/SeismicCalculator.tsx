import React, { useState, useEffect, useMemo } from 'react';
import {
  Activity,
  Settings,
  Calculator,
  TrendingUp,
  Info,
  RotateCcw,
} from 'lucide-react';
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Scatter,
} from 'recharts';

// --- Типы данных ---

interface SoilType {
  name: string;
  TB: number; // сек
  TC: number; // сек
  S_factor: number; // Коэффициент грунта (примерный, зависит от ag, здесь упрощено для UI)
}

// Данные согласно Таблице 7.1 СН КР 20-03:2025
const SOIL_TYPES: SoilType[] = [
  { name: 'IA (Скалистые)', TB: 0.15, TC: 0.48, S_factor: 1.0 },
  { name: 'IБ (Скалистые/Плотные)', TB: 0.15, TC: 0.48, S_factor: 1.0 },
  { name: 'II (Плотные грунты)', TB: 0.2, TC: 0.72, S_factor: 1.1 }, // В примере В использован Tc=0.64, но по табл 7.1 норма Tc=0.72
  { name: 'III (Рыхлые грунты)', TB: 0.25, TC: 0.96, S_factor: 1.3 },
];

const SeismoIsolationCalculator: React.FC = () => {
  // --- Состояние (Входные данные из Примера В1) ---

  // Масса и геометрия
  const [mass, setMass] = useState<number>(5665); // M, кН·с²/м (Пример В2.2)
  const [isolatorCount, setIsolatorCount] = useState<number>(35); // n

  // Целевые параметры
  const [T_eff, setT_eff] = useState<number>(3.0); // Целевой период, сек
  const [damping, setDamping] = useState<number>(15); // ξ (xi), % (для расчета перемещений, Этап 5)
  const [yieldDisp, setYieldDisp] = useState<number>(25); // d_y, мм (перемещение текучести, Этап 7)

  // Сейсмичность площадки
  const [ag_ratio, setAg_ratio] = useState<number>(0.44); // ag/g (Пример В1.2)
  const [soilIndex, setSoilIndex] = useState<number>(2); // Тип II по умолчанию

  // --- Вычисления (Memoized) ---
  const results = useMemo(() => {
    const soil = SOIL_TYPES[soilIndex];
    const g = 9.81; // м/с²
    const ag = ag_ratio * g; // Расчетное ускорение

    // 1. Эффективная жесткость системы (Приложение В, Этап 1)
    // K(eff total) = 4 * pi^2 * M / T^2
    const K_eff_total = (4 * Math.pow(Math.PI, 2) * mass) / Math.pow(T_eff, 2);

    // 2. Жесткость одной опоры (Приложение В, Этап 2)
    // K(eff) = K(eff total) / n
    const K_eff = K_eff_total / isolatorCount;

    // 3. Коэффициент демпфирования η (eta) (Формулы 7.10-7.14, Этап 5)
    // Используем упрощенную формулу (7.10) для T=3c
    const xi_fraction = damping / 100;
    const eta = Math.sqrt(10 / (5 + damping));

    // 4. Спектр упругих реакций Se(T) (Этап 3, Формула 7.9 для T > Tc)
    // Se(T) = ag * S * η * 2.5 * (Tc / T)
    // Примечание: В примере B2.4 используется T=3.0, Tc=0.64. Мы используем формулу динамически.
    let Se_T = 0;
    if (T_eff >= soil.TC) {
      Se_T = ag_ratio * g * soil.S_factor * 2.5 * eta * (soil.TC / T_eff);
    } else if (T_eff >= soil.TB) {
      Se_T = ag_ratio * g * soil.S_factor * 2.5 * eta;
    } else {
      // Упрощенно для малых периодов (линейный рост)
      Se_T =
        ag_ratio *
        g *
        soil.S_factor *
        (1 + (T_eff / soil.TB) * (2.5 * eta - 1));
    }

    // 5. Спектр перемещений SDe(T) или d(dc) (Этап 4-5, Формула 7.15)
    // d(dc) = Se(T) * (T / 2pi)^2
    const d_dc_m = Se_T * Math.pow(T_eff / (2 * Math.PI), 2);
    const d_dc_mm = d_dc_m * 1000;

    // 6. Поперечная сила F(dc) при расчетном перемещении (Этап 6)
    // F(dc) = K(eff) * d(dc)
    const F_dc = K_eff * d_dc_m;

    // 7. Характеристическая сила F0 (Этап 7, Формула из В2.8)
    // F0 = (ξ * π * K(eff) * d(dc)^2) / (2 * (d(dc) - dy))
    // dy переводим в метры для формулы
    const dy_m = yieldDisp / 1000;

    let F_0 = 0;
    if (d_dc_m > dy_m) {
      F_0 =
        (xi_fraction * Math.PI * K_eff * Math.pow(d_dc_m, 2)) /
        (2 * (d_dc_m - dy_m));
    }

    // 8. Сила текучести Fy (Этап 8)
    // Fy = F0 + (F(dc) - F0) * (dy / d(dc))
    // Это точка перехода от упругости к пластичности
    const F_y = F_0 + (F_dc - F_0) * (dy_m / d_dc_m);

    // 9. Жесткости K1 и K2 (Этап 9)
    // K1 (упругая) = Fy / dy
    const K_1 = dy_m > 0 ? F_y / dy_m : 0;

    // K2 (пост-упругая/пластическая)
    // K2 = (F(dc) - F_y) / (d(dc) - dy)
    // Проверка на случай если d(dc) <= dy (линейная работа)
    const K_2 = d_dc_m > dy_m ? (F_dc - F_y) / (d_dc_m - dy_m) : K_1;

    // --- Генерация данных для графика (Гистерезисная петля) ---
    // Строим билинейную модель по точкам: (0,0) -> (dy, Fy) -> (ddc, Fdc) -> разгрузка -> ...

    const hysteresisData = [];

    // Точка 1: Начало (0,0)
    // Точка 2: Текучесть (+dy, +Fy)
    // Точка 3: Максимум (+ddc, +Fdc)
    // Разгрузка идет параллельно K1. F_unloading = Fdc - 2*Fy (примерно, для полной петли)
    // Точка 4: Пересечение оси сил при обратном ходе (+ddc - 2*Fdc/K1 ?? Нет, проще по геометрии)
    // Упрощенная петля по 4 ключевым точкам (идеализированная, рис В.2)

    // Верхняя ветвь (нагружение)
    hysteresisData.push({ x: 0, y: 0, label: 'Start' });
    hysteresisData.push({ x: yieldDisp, y: F_y, label: 'Yield (+)' });
    hysteresisData.push({ x: d_dc_mm, y: F_dc, label: 'Max (+)' });

    // Разгрузка (идем вниз параллельно K1 пока не достигнем -Fy уровня пластичности)
    // Точка начала пластичности в обратную сторону: x = d_dc - 2*(d_dc - F0/K2)...
    // Проще: строим симметричный параллелограмм

    // Точка пересечения оси Y (при x=0) на обратном ходе = F0
    hysteresisData.push({ x: 0, y: F_0, label: 'F0 (+)' });

    // Точка начала пластичности (-) : (-dy, -Fy) смещенная на пластическую деформацию?
    // Нет, идеализированная петля (Рис В.2) симметрична относительно центра, но имеет ширину.
    // Координаты углов параллелограмма:
    // 1. (d_dc, F_dc)
    // 2. (d_dc - 2*dy, F_dc - 2*Fy) -> Если K1 очень большой, это почти вертикально вниз
    // Строим полный цикл:

    const loopData = [
      { x: d_dc_mm, y: F_dc }, // Max positive
      { x: d_dc_mm - 2 * yieldDisp, y: F_dc - 2 * F_y }, // Start reverse plastic (approx)
      { x: -d_dc_mm, y: -F_dc }, // Max negative
      { x: -d_dc_mm + 2 * yieldDisp, y: -F_dc + 2 * F_y }, // Start forward plastic
      { x: d_dc_mm, y: F_dc }, // Close loop
    ];

    // Линия начальной жесткости (для визуализации K1)
    const elasticLine = [
      { x: 0, y: 0 },
      { x: yieldDisp, y: F_y },
    ];

    // Линия эффективной жесткости (Keff)
    const effectiveLine = [
      { x: 0, y: 0 },
      { x: d_dc_mm, y: F_dc },
    ];

    return {
      K_eff_total,
      K_eff,
      eta,
      Se_T,
      d_dc_m,
      d_dc_mm,
      F_dc,
      F_0,
      F_y,
      K_1,
      K_2,
      loopData,
      elasticLine,
      effectiveLine,
    };
  }, [mass, isolatorCount, T_eff, damping, yieldDisp, ag_ratio, soilIndex]);

  // Сброс к значениям примера
  const resetToExample = () => {
    setMass(5665);
    setT_eff(3.0);
    setDamping(15);
    setAg_ratio(0.44);
    setIsolatorCount(35);
    setYieldDisp(25);
    setSoilIndex(2);
  };

  return (
    <div className='min-h-screen bg-gray-50 text-gray-800 font-sans p-4 md:p-8'>
      <div className='max-w-7xl mx-auto grid grid-cols-1 xl:grid-cols-12 gap-6'>
        {/* Хедер */}
        <div className='xl:col-span-12 flex flex-col md:flex-row justify-between items-center bg-white p-6 rounded-2xl shadow-sm border border-gray-200'>
          <div>
            <h1 className='text-2xl font-bold flex items-center gap-2 text-blue-900'>
              <Activity className='text-blue-600' />
              Калькулятор Сейсмоизоляции
            </h1>
            <p className='text-sm text-gray-500 mt-1'>
              На основе СН КР 20-03:2025 и Приложения В (Метод эквивалентной
              линеаризации)
            </p>
          </div>
          <button
            onClick={resetToExample}
            className='mt-4 md:mt-0 flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors'
          >
            <RotateCcw size={16} />
            Загрузить Пример В1
          </button>
        </div>

        {/* Левая колонка: Ввод данных */}
        <div className='xl:col-span-4 space-y-6'>
          <div className='bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden'>
            <div className='bg-slate-800 px-6 py-4 flex items-center gap-2 text-white'>
              <Settings size={18} />
              <h2 className='font-semibold'>Параметры Суперструктуры</h2>
            </div>

            <div className='p-6 space-y-5'>
              {/* Масса */}
              <div>
                <label className='block text-xs font-bold text-gray-500 uppercase mb-2'>
                  Масса M (кН·с²/м)
                </label>
                <div className='relative'>
                  <input
                    type='number'
                    value={mass}
                    onChange={(e) => setMass(Number(e.target.value))}
                    className='w-full border border-gray-300 rounded-lg py-2 px-3 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none font-mono'
                  />
                  <div className='absolute right-3 top-2.5 text-xs text-gray-400'>
                    В1.9
                  </div>
                </div>
              </div>

              {/* Кол-во опор */}
              <div>
                <label className='block text-xs font-bold text-gray-500 uppercase mb-2'>
                  Количество опор (n)
                </label>
                <input
                  type='number'
                  value={isolatorCount}
                  onChange={(e) => setIsolatorCount(Number(e.target.value))}
                  className='w-full border border-gray-300 rounded-lg py-2 px-3 focus:ring-2 focus:ring-blue-500 outline-none font-mono'
                />
              </div>

              {/* Период */}
              <div>
                <div className='flex justify-between mb-2'>
                  <label className='text-xs font-bold text-gray-500 uppercase'>
                    Целевой Период T(eff)
                  </label>
                  <span className='text-blue-600 font-bold text-sm'>
                    {T_eff.toFixed(2)} сек
                  </span>
                </div>
                <input
                  type='range'
                  min='1'
                  max='5'
                  step='0.1'
                  value={T_eff}
                  onChange={(e) => setT_eff(Number(e.target.value))}
                  className='w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600'
                />
              </div>
            </div>
          </div>

          <div className='bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden'>
            <div className='bg-slate-800 px-6 py-4 flex items-center gap-2 text-white'>
              <TrendingUp size={18} />
              <h2 className='font-semibold'>Свойства Опоры и Грунта</h2>
            </div>

            <div className='p-6 space-y-5'>
              {/* Демпфирование */}
              <div>
                <div className='flex justify-between mb-2'>
                  <label className='text-xs font-bold text-gray-500 uppercase'>
                    Демпфирование ξ (eff)
                  </label>
                  <span className='text-blue-600 font-bold text-sm'>
                    {damping}%
                  </span>
                </div>
                <input
                  type='range'
                  min='5'
                  max='30'
                  step='1'
                  value={damping}
                  onChange={(e) => setDamping(Number(e.target.value))}
                  className='w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600'
                />
                <p className='text-xs text-gray-400 mt-1'>
                  Обычно 10-20% для эластомеров (Прим. В1.5)
                </p>
              </div>

              {/* Перемещение текучести */}
              <div>
                <label className='block text-xs font-bold text-gray-500 uppercase mb-2'>
                  Перемещение текучести d(y), мм
                </label>
                <input
                  type='number'
                  value={yieldDisp}
                  onChange={(e) => setYieldDisp(Number(e.target.value))}
                  className='w-full border border-gray-300 rounded-lg py-2 px-3 focus:ring-2 focus:ring-blue-500 outline-none font-mono'
                />
              </div>

              {/* Ускорение */}
              <div>
                <label className='block text-xs font-bold text-gray-500 uppercase mb-2'>
                  Ускорение грунта a(g), g
                </label>
                <select
                  value={ag_ratio}
                  onChange={(e) => setAg_ratio(Number(e.target.value))}
                  className='w-full border border-gray-300 rounded-lg py-2 px-3 bg-white outline-none'
                >
                  <option value={0.1}>0.10g</option>
                  <option value={0.2}>0.20g</option>
                  <option value={0.3}>0.30g</option>
                  <option value={0.4}>0.40g</option>
                  <option value={0.44}>0.44g (Пример)</option>
                  <option value={0.5}>0.50g</option>
                </select>
              </div>

              {/* Тип грунта */}
              <div>
                <label className='block text-xs font-bold text-gray-500 uppercase mb-2'>
                  Тип Грунта (СН КР Табл 7.1)
                </label>
                <div className='grid grid-cols-1 gap-2'>
                  {SOIL_TYPES.map((type, idx) => (
                    <button
                      key={idx}
                      onClick={() => setSoilIndex(idx)}
                      className={`text-left text-sm px-3 py-2 rounded-md border transition-all ${
                        soilIndex === idx
                          ? 'border-blue-500 bg-blue-50 text-blue-800 font-medium'
                          : 'border-gray-200 hover:border-gray-300 text-gray-600'
                      }`}
                    >
                      {type.name}{' '}
                      <span className='text-xs text-gray-400 ml-1'>
                        (Tc={type.TC}c)
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Правая колонка: Результаты и Графики */}
        <div className='xl:col-span-8 space-y-6'>
          {/* Блок основных результатов */}
          <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4'>
            <ResultCard
              label='Жесткость Системы K(eff total)'
              value={Math.round(results.K_eff_total).toLocaleString()}
              unit='кН/м'
              subText='Этап 1'
            />
            <ResultCard
              label='Жесткость Опоры K(eff)'
              value={Math.round(results.K_eff).toLocaleString()}
              unit='кН/м'
              highlight
              subText='Этап 2'
            />
            <ResultCard
              label='Перемещение d(dc)'
              value={results.d_dc_mm.toFixed(0)}
              unit='мм'
              subText='Этап 5'
            />
            <ResultCard
              label='Поперечная Сила F(dc)'
              value={results.F_dc.toFixed(1)}
              unit='кН'
              subText='Этап 6'
            />
          </div>

          {/* Блок детальных параметров билинейной модели */}
          <div className='bg-white rounded-2xl shadow-sm border border-gray-200 p-6'>
            <h3 className='text-lg font-bold text-gray-800 mb-4 flex items-center gap-2'>
              <Calculator size={20} className='text-gray-400' />
              Параметры Гистерезиса (Билинейная модель)
            </h3>
            <div className='grid grid-cols-2 md:grid-cols-4 gap-y-4 gap-x-8 text-sm'>
              <div>
                <p className='text-gray-500'>Коэф. η (eta)</p>
                <p className='font-mono font-medium text-lg'>
                  {results.eta.toFixed(3)}
                </p>
              </div>
              <div>
                <p className='text-gray-500'>Сила F(0)</p>
                <p className='font-mono font-medium text-lg'>
                  {results.F_0.toFixed(1)} кН
                </p>
              </div>
              <div>
                <p className='text-gray-500'>Сила Текучести F(y)</p>
                <p className='font-mono font-medium text-lg'>
                  {results.F_y.toFixed(1)} кН
                </p>
              </div>
              <div>
                <p className='text-gray-500'>Нач. Жесткость K(1)</p>
                <p className='font-mono font-medium text-lg'>
                  {Math.round(results.K_1).toLocaleString()} кН/м
                </p>
              </div>
            </div>
          </div>

          {/* График */}
          <div className='bg-white rounded-2xl shadow-sm border border-gray-200 p-6 h-[500px] flex flex-col'>
            <div className='flex justify-between items-center mb-4'>
              <h3 className='text-lg font-bold text-gray-800'>
                Идеализированная диаграмма "Нагрузка - Перемещение"
              </h3>
              <div className='text-xs text-right text-gray-400'>
                Рис В.2 (Приложение В)
                <br />
                Ось X: Перемещение (мм), Ось Y: Сила (кН)
              </div>
            </div>

            <div className='flex-1 w-full'>
              <ResponsiveContainer width='100%' height='100%'>
                <ComposedChart
                  margin={{ top: 20, right: 30, bottom: 20, left: 20 }}
                >
                  <CartesianGrid strokeDasharray='3 3' stroke='#e5e7eb' />
                  <XAxis
                    dataKey='x'
                    type='number'
                    label={{
                      value: 'Перемещение d (мм)',
                      position: 'bottom',
                      offset: 0,
                    }}
                    domain={[-results.d_dc_mm * 1.2, results.d_dc_mm * 1.2]}
                  />
                  <YAxis
                    dataKey='y'
                    type='number'
                    label={{
                      value: 'Сила F (кН)',
                      angle: -90,
                      position: 'left',
                    }}
                    domain={[-results.F_dc * 1.2, results.F_dc * 1.2]}
                  />
                  <Tooltip
                    formatter={(value: number) => value.toFixed(1)}
                    labelFormatter={(label: number) =>
                      `d: ${label.toFixed(1)} мм`
                    }
                    contentStyle={{
                      borderRadius: '8px',
                      border: 'none',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                    }}
                  />
                  <ReferenceLine x={0} stroke='#9ca3af' />
                  <ReferenceLine y={0} stroke='#9ca3af' />

                  {/* Гистерезисная петля */}
                  <Line
                    data={results.loopData}
                    type='linear'
                    dataKey='y'
                    stroke='#2563eb'
                    strokeWidth={3}
                    dot={{ r: 4, fill: '#2563eb' }}
                    name='Гистерезис'
                    animationDuration={500}
                  />

                  {/* Линия K(eff) */}
                  <Line
                    data={results.effectiveLine}
                    type='linear'
                    dataKey='y'
                    stroke='#10b981'
                    strokeDasharray='5 5'
                    strokeWidth={2}
                    dot={false}
                    name='K(eff)'
                  />

                  {/* Линия K(1) - Начальная жесткость */}
                  <Line
                    data={results.elasticLine}
                    type='linear'
                    dataKey='y'
                    stroke='#f59e0b'
                    strokeDasharray='3 3'
                    strokeWidth={2}
                    dot={false}
                    name='K(1)'
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className='flex justify-center gap-6 mt-4 text-xs font-medium'>
              <div className='flex items-center gap-2'>
                <span className='w-3 h-3 bg-blue-600 rounded-full'></span>
                Гистерезисная петля
              </div>
              <div className='flex items-center gap-2'>
                <span className='w-3 h-1 bg-emerald-500 border-t border-emerald-500 border-dashed'></span>
                Эффективная жесткость K(eff)
              </div>
              <div className='flex items-center gap-2'>
                <span className='w-3 h-1 bg-amber-500 border-t border-amber-500 border-dashed'></span>
                Начальная жесткость K(1)
              </div>
            </div>
          </div>
        </div>

        {/* Инфо футер */}
        <div className='xl:col-span-12 mt-4 bg-amber-50 border border-amber-100 rounded-xl p-4 flex items-start gap-3'>
          <Info className='text-amber-600 shrink-0 mt-0.5' size={20} />
          <div>
            <h4 className='font-bold text-amber-900 text-sm'>
              Важное примечание по использованию (п. 8.4)
            </h4>
            <p className='text-sm text-amber-800 mt-1'>
              Данный калькулятор реализует метод эквивалентной линеаризации
              (Приложение В). Для зданий II класса ответственности и выше,
              окончательные параметры должны быть подтверждены расчетом во
              временной области (Time History Analysis) с использованием не
              менее трех акселерограмм, как описано в Приложении Г.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

// Компонент карточки результата
const ResultCard = ({
  label,
  value,
  unit,
  highlight = false,
  subText,
}: {
  label: string;
  value: string;
  unit: string;
  highlight?: boolean;
  subText?: string;
}) => (
  <div
    className={`p-4 rounded-xl border ${
      highlight
        ? 'bg-blue-600 border-blue-600 text-white'
        : 'bg-white border-gray-200 text-gray-800'
    } shadow-sm flex flex-col justify-between h-28`}
  >
    <div className='flex justify-between items-start'>
      <span
        className={`text-xs font-bold uppercase ${
          highlight ? 'text-blue-200' : 'text-gray-400'
        }`}
      >
        {label}
      </span>
      {subText && (
        <span
          className={`text-[10px] ${
            highlight ? 'text-blue-200' : 'text-gray-300'
          }`}
        >
          {subText}
        </span>
      )}
    </div>
    <div className='flex items-baseline gap-1'>
      <span className='text-3xl font-mono font-bold tracking-tight'>
        {value}
      </span>
      <span
        className={`text-sm font-medium ${
          highlight ? 'text-blue-100' : 'text-gray-500'
        }`}
      >
        {unit}
      </span>
    </div>
  </div>
);

export default SeismoIsolationCalculator;
