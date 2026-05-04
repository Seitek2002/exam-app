interface CalcInput {
  mass: number;
  isolatorCount: number;
  T_eff: number;
  damping: number;
  yieldDisp: number;
  ag_ratio: number;
  soil: {
    TB: number;
    TC: number;
    S_factor: number;
  };
}

export function calculateSeismicIsolation({
  mass,
  isolatorCount,
  T_eff,
  damping,
  yieldDisp,
  ag_ratio,
  soil,
}: CalcInput) {
  const g = 9.81;

  const xi = damping / 100;
  const dy_m = yieldDisp / 1000;

  // 1. Жесткость
  const safeT = Math.max(T_eff, 0.1);

  const K_eff_total = (4 * Math.PI ** 2 * mass) / safeT ** 2;

  const K_eff = isolatorCount > 0 ? K_eff_total / isolatorCount : 0;

  // 2. η (правильная формула)
  const xiSafe = Math.min(Math.max(xi, 0.01), 0.3);
  const rho = 1 + (0.05 - xiSafe) / (0.05 + 2 * xiSafe - 3 * xiSafe ** 2);
  const lambda = (0.05 - xiSafe) / (0.33 + 9 * xiSafe);

  const eta = rho * Math.pow(1 / safeT, lambda);

  // 3. Спектр с учетом демпфирования
  let Se = 0;

  if (safeT >= soil.TC) {
    Se = ag_ratio * g * soil.S_factor * 2.5 * eta * (soil.TC / T_eff);
  } else if (T_eff >= soil.TB) {
    Se = ag_ratio * g * soil.S_factor * 2.5 * eta;
  } else {
    Se =
      ag_ratio * g * soil.S_factor * (1 + (T_eff / soil.TB) * (2.5 * eta - 1));
  }

  // 4. Перемещение
  const d_dc_m = Se * (T_eff / (2 * Math.PI)) ** 2;
  const d_dc_mm = d_dc_m * 1000;

  // 5. Сила
  const F_dc = K_eff * d_dc_m;

  // 6. F0
  let F_0 = 0;

  if (d_dc_m > dy_m && dy_m > 0) {
    F_0 = (xi * Math.PI * K_eff * d_dc_m ** 2) / (2 * (d_dc_m - dy_m));
  }

  // 7. Fy
  const F_y =
    d_dc_m > 0 ? F_0 + (F_dc - F_0) * (dy_m / Math.max(d_dc_m, 0.0001)) : 0;

  // 8. Жесткости
  const K_1 = dy_m > 0 ? F_y / dy_m : 0;

  const K_2 = d_dc_m > dy_m ? (F_dc - F_y) / (d_dc_m - dy_m) : K_1;

  // 🔥 ПРОВЕРКИ (ВАЖНО ДЛЯ ДИПЛОМА)

  const warnings = [];

  // Проверка эффективности (норма: изоляция должна увеличивать период)
  if (T_eff < 2.5) {
    warnings.push('Период изоляции слишком мал (рекомендуется ≥ 2.5с)');
  }

  // Перемещение (реалистичный диапазон)
  if (d_dc_mm > 350) {
    warnings.push('Перемещение превышает допустимый диапазон (>350 мм)');
  }

  // Пластическая работа
  if (F_0 <= 0) {
    warnings.push('Изолятор не работает в пластической стадии');
  }

  // Жесткость
  if (K_2 > K_1) {
    warnings.push('Некорректная билинейная модель (K2 > K1)');
  }

  return {
    K_eff_total,
    K_eff,
    eta,
    Se_T: Se,
    d_dc_m,
    d_dc_mm,
    F_dc,
    F_0,
    F_y,
    K_1,
    K_2,
    warnings,
  };
}
