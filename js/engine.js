/**
 * Teyvat AU — Cascade Calculation Engine
 * Движок каскадного пересчёта показателей
 */

class CascadeEngine {
  constructor(rules, metricsMeta) {
    this.influences = rules.influences || [];
    this.cascades = rules.cascades || [];
    this.elementaliumBonuses = rules.elementaliumBonuses || [];
    this.metricsMeta = metricsMeta || {};
  }

  clamp(val) {
    return Math.max(0, Math.min(12, Math.round(val)));
  }

  /**
   * Применяет бафф/дебафф к нации и пересчитывает каскады.
   * @param {Object} nation — объект нации (с metrics, era)
   * @param {string} metricKey — ключ метрики
   * @param {number} delta — изменение (+/-)
   * @returns {{ newMetrics, log, warnings }} — результат
   */
  applyChange(nation, metricKey, delta) {
    const log = [];
    const warnings = [];
    const metrics = { ...nation.metrics };
    const era = nation.era;

    const oldVal = metrics[metricKey];
    metrics[metricKey] = this.clamp(oldVal + delta);
    const actualDelta = metrics[metricKey] - oldVal;

    if (actualDelta === 0 && delta !== 0) {
      log.push(`${this.getMetricName(metricKey)}: ${oldVal} → ${metrics[metricKey]} (ограничено 0–12)`);
    } else {
      log.push(`${this.getMetricName(metricKey)}: ${oldVal} → ${metrics[metricKey]} (${delta > 0 ? '+' : ''}${delta})`);
    }

    // influence propagation
    const influenced = this.propagateInfluences(metrics, metricKey, actualDelta, era, log);

    // cascade checks
    this.checkCascades(metrics, warnings, log);

    // elementalium bonuses
    this.checkElementalium(metrics, era, warnings);

    return { newMetrics: metrics, log, warnings };
  }

  /**
   * Применяет пакет изменений за ход.
   */
  applyTurnChanges(nation, changes) {
    const log = [];
    const warnings = [];
    const metrics = { ...nation.metrics };
    const era = nation.era;

    // Phase 1: direct changes
    for (const { metric, delta } of changes) {
      const oldVal = metrics[metric];
      metrics[metric] = this.clamp(oldVal + delta);
      log.push(`${this.getMetricName(metric)}: ${oldVal} → ${metrics[metric]} (${delta > 0 ? '+' : ''}${delta})`);
    }

    // Phase 2: influence propagation from all changes
    const propagated = new Set();
    for (const { metric, delta } of changes) {
      const actualDelta = metrics[metric] - (nation.metrics[metric] || 0);
      if (actualDelta !== 0) {
        this.propagateInfluences(metrics, metric, actualDelta, era, log, propagated);
      }
    }

    // Phase 3: cascades
    this.checkCascades(metrics, warnings, log);

    // Phase 4: elementalium
    this.checkElementalium(metrics, era, warnings);

    return { newMetrics: metrics, log, warnings };
  }

  propagateInfluences(metrics, sourceKey, delta, era, log, visited = new Set()) {
    if (visited.has(sourceKey) || delta === 0) return;
    visited.add(sourceKey);

    for (const inf of this.influences) {
      if (inf.source !== sourceKey) continue;
      if (inf.eraMin && era < inf.eraMin) continue;

      const propagatedDelta = delta * inf.weight;
      if (Math.abs(propagatedDelta) < 0.25) continue;

      const rounded = Math.round(propagatedDelta);
      if (rounded === 0) continue;

      const oldVal = metrics[inf.target];
      metrics[inf.target] = this.clamp(oldVal + rounded);
      const effective = metrics[inf.target] - oldVal;

      if (effective !== 0) {
        log.push(`  ↳ ${this.getMetricName(inf.target)}: ${oldVal} → ${metrics[inf.target]} (${inf.label})`);
      }
    }
  }

  checkCascades(metrics, warnings, log) {
    for (const cascade of this.cascades) {
      const val = metrics[cascade.trigger];
      let triggered = false;

      if (cascade.condition === 'lt' && val < cascade.threshold) triggered = true;
      if (cascade.condition === 'eq' && val === cascade.threshold) triggered = true;
      if (cascade.condition === 'lte' && val <= cascade.threshold) triggered = true;

      if (!triggered) continue;

      warnings.push({
        id: cascade.id,
        label: cascade.label,
        desc: cascade.desc,
        severity: cascade.id === 'civil_war' ? 'critical' : 'danger'
      });

      if (cascade.effects === 'all_minus_3') {
        for (const key of Object.keys(metrics)) {
          const old = metrics[key];
          metrics[key] = this.clamp(old - 3);
          if (metrics[key] !== old) {
            log.push(`  ⚠ ГРАЖДАНСКАЯ ВОЙНА: ${this.getMetricName(key)}: ${old} → ${metrics[key]}`);
          }
        }
        continue;
      }

      if (!Array.isArray(cascade.effects)) continue;

      for (const eff of cascade.effects) {
        const old = metrics[eff.target];
        let newVal;

        if (eff.delta === 'half') {
          newVal = this.clamp(Math.floor(old / 2));
        } else if (eff.delta === 'zero') {
          newVal = 0;
        } else {
          newVal = this.clamp(old + eff.delta);
        }

        metrics[eff.target] = newVal;
        if (newVal !== old) {
          log.push(`  ⚠ ${cascade.label}: ${this.getMetricName(eff.target)}: ${old} → ${newVal}`);
        }
      }
    }
  }

  checkElementalium(metrics, era, warnings) {
    const elem = metrics.elementalium;
    for (const bonus of this.elementaliumBonuses) {
      if (elem >= bonus.min && elem <= bonus.max) {
        if (elem === 0) {
          warnings.push({
            id: 'elem_critical',
            label: 'Элементалиум: Критический дефицит',
            desc: bonus.effects,
            severity: 'danger'
          });
        } else if (elem <= 3) {
          warnings.push({
            id: 'elem_deficit',
            label: 'Элементалиум: Дефицит',
            desc: bonus.effects,
            severity: 'warning'
          });
        }
        break;
      }
    }
  }

  getMetricName(key) {
    return this.metricsMeta[key]?.name || key;
  }

  /**
   * Получить все активные предупреждения для нации
   */
  getActiveWarnings(nation) {
    const warnings = [];
    const metrics = nation.metrics;

    for (const cascade of this.cascades) {
      const val = metrics[cascade.trigger];
      let triggered = false;

      if (cascade.condition === 'lt' && val < cascade.threshold) triggered = true;
      if (cascade.condition === 'eq' && val === cascade.threshold) triggered = true;

      if (triggered) {
        warnings.push({
          id: cascade.id,
          label: cascade.label,
          desc: cascade.desc,
          severity: cascade.id === 'civil_war' ? 'critical' : 'danger'
        });
      }
    }

    this.checkElementalium(metrics, nation.era, warnings);
    return warnings;
  }

  /**
   * Получить значение цвета для метрики
   */
  getMetricColor(val) {
    if (val <= 2) return 'critical';
    if (val <= 4) return 'low';
    if (val <= 6) return 'medium';
    if (val <= 9) return 'high';
    return 'excellent';
  }

  /**
   * Суммарная мощь по категории
   */
  getCategoryTotal(metrics, categoryKey) {
    let total = 0;
    let count = 0;
    for (const [key, meta] of Object.entries(this.metricsMeta)) {
      if (meta.category === categoryKey) {
        total += metrics[key];
        count++;
      }
    }
    return { total, count, avg: count > 0 ? (total / count).toFixed(1) : 0 };
  }
}

// Export for use
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CascadeEngine;
}
