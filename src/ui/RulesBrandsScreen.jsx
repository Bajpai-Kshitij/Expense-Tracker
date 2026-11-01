import React, { useState, useEffect } from 'react';
import { compilePattern } from '../core/categorize/pattern.js';
import { categorize } from '../core/categorize/categorize.js';

export default function RulesBrandsScreen({
  db,
  writer,
  brands = [],
  rules = [],
  categories = [],
  accounts = [],
  onBack,
  showToast,
  onReloadLookups,
}) {
  const [subTab, setSubTab] = useState('rules'); // 'rules' | 'brands' | 'categories'
  const [usageCounts, setUsageCounts] = useState({});

  // Rule Editor State
  const [ruleModal, setRuleModal] = useState({
    open: false,
    rule: null,
    priority: 10,
    field: 'merchant',
    pattern: '',
    mode: 'words',
    categoryId: '',
    kind: '',
    accountId: '',
    direction: '',
    minRupees: '',
    maxRupees: '',
    note: '',
    active: true,
  });

  // Brand Editor State
  const [brandModal, setBrandModal] = useState({
    open: false,
    brand: null,
    name: '',
    pattern: '',
    mode: 'words',
    categoryId: '',
    kind: '',
    note: '',
    priority: 10,
    active: true,
  });

  // Category Editor State
  const [catModal, setCatModal] = useState({
    open: false,
    category: null,
    name: '',
    icon: '🏷️',
    color: '#3b82f6',
  });

  // Tester State
  const [testerText, setTesterText] = useState('SWIGGY PVT.');

  const categoriesMap = categories.reduce((acc, c) => {
    acc[c.id] = c;
    return acc;
  }, {});

  const activeCategories = categories.filter((c) => !c.archived);

  // Load category usage counts
  const loadUsage = async () => {
    if (!db) return;
    try {
      const rows = await db.query(
        `SELECT category_id, COUNT(*) as cnt 
         FROM expenses 
         WHERE status = 'active' AND category_id IS NOT NULL 
         GROUP BY category_id;`
      );
      const counts = {};
      for (const r of rows) {
        counts[r.category_id] = r.cnt;
      }
      setUsageCounts(counts);
    } catch (e) {
      console.error('Failed to load category usage:', e);
    }
  };

  useEffect(() => {
    loadUsage();
  }, [db]);

  // Sort rules by priority ASC, id ASC
  const sortedRules = [...rules].sort((a, b) => {
    const pA = a.priority ?? 100;
    const pB = b.priority ?? 100;
    if (pA !== pB) return pA - pB;
    return (a.id || '').localeCompare(b.id || '');
  });

  // Sort brands by priority ASC, id ASC
  const sortedBrands = [...brands].sort((a, b) => {
    const pA = a.priority ?? 100;
    const pB = b.priority ?? 100;
    if (pA !== pB) return pA - pB;
    return (a.id || '').localeCompare(b.id || '');
  });

  // Live tester simulation
  const simulatedRules = sortedRules.map((r) => {
    if (ruleModal.open && ruleModal.rule && r.id === ruleModal.rule.id) {
      return {
        ...r,
        priority: Number(ruleModal.priority) || 10,
        field: ruleModal.field,
        pattern: ruleModal.pattern,
        mode: ruleModal.mode,
        categoryId: ruleModal.categoryId,
        kind: ruleModal.kind || null,
        accountId: ruleModal.accountId || null,
        direction: ruleModal.direction || null,
        active: ruleModal.active,
      };
    }
    return r;
  });

  const testerResult = categorize(
    {
      merchantRaw: testerText,
      direction: 'debit',
      amountPaise: 10000,
    },
    {
      brands: sortedBrands,
      rules: simulatedRules,
      accounts,
    }
  );

  // --- RULE ACTIONS ---
  const handleToggleRuleActive = async (rule) => {
    if (!writer) return;
    try {
      const updated = { ...rule, active: !rule.active };
      await writer.write('rule.upserted', updated);
      if (onReloadLookups) await onReloadLookups();
      showToast(`Rule ${updated.active ? 'enabled' : 'disabled'}`);
    } catch (e) {
      console.error('Failed to toggle rule:', e);
    }
  };

  const handleMoveRule = async (index, direction) => {
    if (!writer) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= sortedRules.length) return;

    try {
      const copy = [...sortedRules];
      const temp = copy[index];
      copy[index] = copy[targetIndex];
      copy[targetIndex] = temp;

      // Renumber with gaps of 10
      for (let i = 0; i < copy.length; i++) {
        const expectedPriority = (i + 1) * 10;
        if (copy[i].priority !== expectedPriority) {
          const updated = { ...copy[i], priority: expectedPriority };
          await writer.write('rule.upserted', updated);
        }
      }

      if (onReloadLookups) await onReloadLookups();
      showToast('Rule priorities renumbered with gaps of 10');
    } catch (e) {
      console.error('Failed to reorder rules:', e);
    }
  };

  const handleDeleteRule = async (rule) => {
    if (!writer) return;
    const confirmed = window.confirm(`Delete rule "${rule.pattern}"?`);
    if (!confirmed) return;
    try {
      await writer.write('rule.deleted', { ruleId: rule.id });
      if (onReloadLookups) await onReloadLookups();
      showToast('Rule deleted');
    } catch (e) {
      console.error('Failed to delete rule:', e);
    }
  };

  const handleOpenRuleModal = (rule = null) => {
    if (rule) {
      setRuleModal({
        open: true,
        rule,
        priority: rule.priority ?? 10,
        field: rule.field || 'merchant',
        pattern: rule.pattern || '',
        mode: rule.mode || 'words',
        categoryId: rule.categoryId || (activeCategories[0]?.id || ''),
        kind: rule.kind || '',
        accountId: rule.accountId || '',
        direction: rule.direction || '',
        minRupees: rule.minPaise ? (rule.minPaise / 100).toString() : '',
        maxRupees: rule.maxPaise ? (rule.maxPaise / 100).toString() : '',
        note: rule.note || '',
        active: rule.active !== false,
      });
    } else {
      const nextPriority = sortedRules.length > 0
        ? Math.max(...sortedRules.map((r) => r.priority ?? 10)) + 10
        : 10;
      setRuleModal({
        open: true,
        rule: null,
        priority: nextPriority,
        field: 'merchant',
        pattern: '',
        mode: 'words',
        categoryId: activeCategories[0]?.id || '',
        kind: '',
        accountId: '',
        direction: '',
        minRupees: '',
        maxRupees: '',
        note: '',
        active: true,
      });
    }
  };

  const handleSaveRule = async () => {
    if (!writer) return;
    const patternVal = compilePattern({ pattern: ruleModal.pattern, mode: ruleModal.mode });
    if (!patternVal.ok) return;

    try {
      const minPaise = ruleModal.minRupees ? Math.round(parseFloat(ruleModal.minRupees) * 100) : null;
      const maxPaise = ruleModal.maxRupees ? Math.round(parseFloat(ruleModal.maxRupees) * 100) : null;

      const ruleObj = {
        id: ruleModal.rule ? ruleModal.rule.id : `rule_${Date.now()}`,
        priority: Number(ruleModal.priority) || 10,
        field: ruleModal.field,
        pattern: ruleModal.pattern.trim(),
        mode: ruleModal.mode,
        categoryId: ruleModal.categoryId,
        kind: ruleModal.kind || null,
        accountId: ruleModal.accountId || null,
        direction: ruleModal.direction || null,
        minPaise: isNaN(minPaise) ? null : minPaise,
        maxPaise: isNaN(maxPaise) ? null : maxPaise,
        note: ruleModal.note.trim(),
        active: Boolean(ruleModal.active),
      };

      await writer.write('rule.upserted', ruleObj);
      setRuleModal({ ...ruleModal, open: false, rule: null });
      if (onReloadLookups) await onReloadLookups();
      showToast(ruleModal.rule ? 'Rule updated' : 'Rule created');
    } catch (e) {
      console.error('Failed to save rule:', e);
    }
  };

  // --- BRAND ACTIONS ---
  const handleToggleBrandActive = async (brand) => {
    if (!writer) return;
    try {
      const updated = { ...brand, active: !brand.active };
      await writer.write('brand.upserted', updated);
      if (onReloadLookups) await onReloadLookups();
      showToast(`Brand ${updated.active ? 'restored' : 'archived'}`);
    } catch (e) {
      console.error('Failed to toggle brand:', e);
    }
  };

  const handleOpenBrandModal = (brand = null) => {
    if (brand) {
      setBrandModal({
        open: true,
        brand,
        name: brand.name || '',
        pattern: brand.pattern || '',
        mode: brand.mode || 'words',
        categoryId: brand.categoryId || '',
        kind: brand.kind || '',
        note: brand.note || '',
        priority: brand.priority ?? 10,
        active: brand.active !== false,
      });
    } else {
      setBrandModal({
        open: true,
        brand: null,
        name: '',
        pattern: '',
        mode: 'words',
        categoryId: '',
        kind: '',
        note: '',
        priority: 10,
        active: true,
      });
    }
  };

  const handleSaveBrand = async () => {
    if (!writer) return;
    const patternVal = compilePattern({ pattern: brandModal.pattern, mode: brandModal.mode });
    if (!patternVal.ok) return;

    try {
      const brandObj = {
        id: brandModal.brand ? brandModal.brand.id : `brand_${Date.now()}`,
        name: brandModal.name.trim(),
        pattern: brandModal.pattern.trim(),
        mode: brandModal.mode,
        categoryId: brandModal.categoryId || null,
        kind: brandModal.kind || null,
        note: brandModal.note.trim(),
        priority: Number(brandModal.priority) || 10,
        active: Boolean(brandModal.active),
      };

      await writer.write('brand.upserted', brandObj);
      setBrandModal({ ...brandModal, open: false, brand: null });
      if (onReloadLookups) await onReloadLookups();
      showToast(brandModal.brand ? 'Brand updated' : 'Brand created');
    } catch (e) {
      console.error('Failed to save brand:', e);
    }
  };

  // --- CATEGORY ACTIONS ---
  const handleToggleCategoryArchived = async (cat) => {
    if (!writer) return;
    try {
      const updated = { ...cat, archived: !cat.archived };
      await writer.write('category.upserted', updated);
      if (onReloadLookups) await onReloadLookups();
      showToast(`Category ${updated.archived ? 'archived' : 'restored'}`);
    } catch (e) {
      console.error('Failed to toggle category archived:', e);
    }
  };

  const handleOpenCategoryModal = (cat = null) => {
    if (cat) {
      setCatModal({
        open: true,
        category: cat,
        name: cat.name || '',
        icon: cat.icon || '🏷️',
        color: cat.color || '#3b82f6',
      });
    } else {
      setCatModal({
        open: true,
        category: null,
        name: '',
        icon: '🏷️',
        color: '#3b82f6',
      });
    }
  };

  const handleSaveCategory = async () => {
    if (!writer || !catModal.name.trim()) return;
    try {
      const catObj = {
        id: catModal.category ? catModal.category.id : `cat_${Date.now()}`,
        name: catModal.name.trim(),
        icon: catModal.icon || '🏷️',
        color: catModal.color || '#3b82f6',
        archived: catModal.category ? Boolean(catModal.category.archived) : false,
      };

      await writer.write('category.upserted', catObj);
      setCatModal({ ...catModal, open: false, category: null });
      if (onReloadLookups) await onReloadLookups();
      showToast(catModal.category ? 'Category updated' : 'Category added');
    } catch (e) {
      console.error('Failed to save category:', e);
    }
  };

  const rulePatternValidation = compilePattern({ pattern: ruleModal.pattern, mode: ruleModal.mode });
  const brandPatternValidation = compilePattern({ pattern: brandModal.pattern, mode: brandModal.mode });

  return (
    <div>
      {/* Top Bar */}
      <div className="card" style={{ marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '4px 10px', minHeight: '32px', fontSize: '0.85rem' }}
            onClick={onBack}
          >
            ← Back to Settings
          </button>
        </div>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 800 }}>Rules, Brands & Categories</h2>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Manage automatic categorization rules, brand matchers, and category directory.
        </p>
      </div>

      {/* Sub Tabs */}
      <div className="sub-tabs-container">
        <button
          type="button"
          className={`sub-tab-btn ${subTab === 'rules' ? 'active' : ''}`}
          onClick={() => setSubTab('rules')}
        >
          Rules ({sortedRules.length})
        </button>
        <button
          type="button"
          className={`sub-tab-btn ${subTab === 'brands' ? 'active' : ''}`}
          onClick={() => setSubTab('brands')}
        >
          Brands ({sortedBrands.length})
        </button>
        <button
          type="button"
          className={`sub-tab-btn ${subTab === 'categories' ? 'active' : ''}`}
          onClick={() => setSubTab('categories')}
        >
          Categories ({categories.length})
        </button>
      </div>

      {/* TAB 1: RULES */}
      {subTab === 'rules' && (
        <div>
          {/* Live Rule Tester Card */}
          <div className="card" style={{ marginBottom: '14px', background: 'var(--bg-card)' }}>
            <div className="card-header">
              <span className="card-title">🧪 Live Rule Tester</span>
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
              Type or tap sample merchant text to see which brand, rule, and category match:
            </div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
              {['SWIGGY PVT.', 'DISTRICT MO', 'AMAZON PAY IN E', 'blinkit.payu@hdfcbank'].map((sample) => (
                <button
                  key={sample}
                  type="button"
                  className="btn btn-secondary"
                  style={{ padding: '3px 8px', fontSize: '0.75rem', minHeight: '26px' }}
                  onClick={() => setTesterText(sample)}
                >
                  {sample}
                </button>
              ))}
            </div>
            <input
              type="text"
              className="form-input"
              value={testerText}
              onChange={(e) => setTesterText(e.target.value)}
              placeholder="e.g. SWIGGY PVT., UBER INDIA, etc."
              style={{ marginBottom: '10px' }}
            />
            <div className="tester-result-box">
              <div className="tester-col">
                <span className="tester-lbl">Matched Brand</span>
                <span className="tester-val">{testerResult.brand || '—'}</span>
              </div>
              <div className="tester-col">
                <span className="tester-lbl">Matched Rule</span>
                <span className="tester-val">{testerResult.matchedRuleId || '—'}</span>
              </div>
              <div className="tester-col">
                <span className="tester-lbl">Target Category</span>
                <span className="tester-val" style={{ fontWeight: 700, color: 'var(--accent-primary)' }}>
                  {categoriesMap[testerResult.categoryId]?.name || 'Uncategorized'}
                </span>
              </div>
              <div className="tester-col">
                <span className="tester-lbl">Kind</span>
                <span className="tester-val">{testerResult.kind || '—'}</span>
              </div>
            </div>
          </div>

          {/* Action Bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Evaluated in priority order (lowest number first)
            </span>
            <button
              type="button"
              className="btn btn-primary"
              style={{ padding: '6px 12px', minHeight: '34px', fontSize: '0.85rem' }}
              onClick={() => handleOpenRuleModal(null)}
            >
              + Add Rule
            </button>
          </div>

          {/* Rules List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {sortedRules.map((rule, idx) => {
              const cat = categoriesMap[rule.categoryId];
              return (
                <div key={rule.id} className="card" style={{ padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="priority-badge">#{rule.priority ?? 100}</span>
                      <strong style={{ fontSize: '0.95rem' }}>{rule.pattern}</strong>
                      <span className="mode-badge">{rule.mode || 'words'}</span>
                    </div>
                    <label className="switch-label">
                      <input
                        type="checkbox"
                        checked={rule.active !== false}
                        onChange={() => handleToggleRuleActive(rule)}
                      />
                      <span style={{ fontSize: '0.75rem', color: rule.active !== false ? 'var(--success)' : 'var(--text-muted)' }}>
                        {rule.active !== false ? 'Active' : 'Disabled'}
                      </span>
                    </label>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '8px 0', fontSize: '0.85rem' }}>
                    <span>➔</span>
                    <span className="cat-chip-dot" style={{ backgroundColor: cat?.color || '#94a3b8' }} />
                    <span style={{ fontWeight: 600 }}>{cat?.name || 'Uncategorized'}</span>
                    {rule.kind && <span className={`badge badge-${rule.kind}`}>{rule.kind}</span>}
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.75rem' }}>
                      (field: {rule.field || 'merchant'})
                    </span>
                  </div>

                  {rule.note && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontStyle: 'italic', marginBottom: '8px' }}>
                      "{rule.note}"
                    </div>
                  )}

                  {/* Move Up/Down, Edit, Delete */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border-color)', paddingTop: '8px' }}>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '2px 8px', minHeight: '28px', fontSize: '0.75rem' }}
                        disabled={idx === 0}
                        onClick={() => handleMoveRule(idx, 'up')}
                      >
                        ▲ Up
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '2px 8px', minHeight: '28px', fontSize: '0.75rem' }}
                        disabled={idx === sortedRules.length - 1}
                        onClick={() => handleMoveRule(idx, 'down')}
                      >
                        ▼ Down
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '2px 10px', minHeight: '28px', fontSize: '0.75rem' }}
                        onClick={() => handleOpenRuleModal(rule)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger"
                        style={{ padding: '2px 10px', minHeight: '28px', fontSize: '0.75rem' }}
                        onClick={() => handleDeleteRule(rule)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 2: BRANDS */}
      {subTab === 'brands' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Starter brands map common merchants to standard brand names & categories.
            </span>
            <button
              type="button"
              className="btn btn-primary"
              style={{ padding: '6px 12px', minHeight: '34px', fontSize: '0.85rem' }}
              onClick={() => handleOpenBrandModal(null)}
            >
              + Add Brand
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {sortedBrands.map((brand) => {
              const cat = categoriesMap[brand.categoryId || brand.default_category_id];
              return (
                <div key={brand.id} className="card" style={{ padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span className="priority-badge">#{brand.priority ?? 10}</span>
                        <strong style={{ fontSize: '0.95rem' }}>{brand.name}</strong>
                        <span className="mode-badge">{brand.mode || 'words'}</span>
                      </div>
                      <code style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginTop: '2px' }}>
                        {brand.pattern}
                      </code>
                    </div>
                    <label className="switch-label">
                      <input
                        type="checkbox"
                        checked={brand.active !== false}
                        onChange={() => handleToggleBrandActive(brand)}
                      />
                      <span style={{ fontSize: '0.75rem', color: brand.active !== false ? 'var(--success)' : 'var(--text-muted)' }}>
                        {brand.active !== false ? 'Active' : 'Archived'}
                      </span>
                    </label>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '8px 0', fontSize: '0.85rem' }}>
                    <span>Default Category:</span>
                    {cat ? (
                      <>
                        <span className="cat-chip-dot" style={{ backgroundColor: cat.color || '#94a3b8' }} />
                        <span style={{ fontWeight: 600 }}>{cat.name}</span>
                      </>
                    ) : (
                      <span style={{ color: 'var(--text-secondary)' }}>(None)</span>
                    )}
                    {brand.kind && <span className={`badge badge-${brand.kind}`}>{brand.kind}</span>}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid var(--border-color)', paddingTop: '8px' }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ padding: '2px 10px', minHeight: '28px', fontSize: '0.75rem' }}
                      onClick={() => handleOpenBrandModal(brand)}
                    >
                      Edit
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 3: CATEGORIES */}
      {subTab === 'categories' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Categories are never deleted because expenses reference them; you can archive them.
            </span>
            <button
              type="button"
              className="btn btn-primary"
              style={{ padding: '6px 12px', minHeight: '34px', fontSize: '0.85rem' }}
              onClick={() => handleOpenCategoryModal(null)}
            >
              + Add Category
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {categories.map((cat) => {
              const usage = usageCounts[cat.id] || 0;
              return (
                <div key={cat.id} className="card" style={{ padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '6px',
                          backgroundColor: cat.color || '#3b82f6',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#ffffff',
                          fontSize: '0.9rem',
                        }}
                      >
                        {cat.icon || '🏷️'}
                      </span>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <strong style={{ fontSize: '0.95rem' }}>{cat.name}</strong>
                          {cat.archived && <span className="archived-tag">Archived</span>}
                        </div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          {usage} {usage === 1 ? 'expense' : 'expenses'}
                        </span>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ padding: '2px 10px', minHeight: '28px', fontSize: '0.75rem' }}
                        onClick={() => handleOpenCategoryModal(cat)}
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{
                          padding: '2px 10px',
                          minHeight: '28px',
                          fontSize: '0.75rem',
                          color: cat.archived ? 'var(--success)' : 'var(--danger)',
                        }}
                        onClick={() => handleToggleCategoryArchived(cat)}
                      >
                        {cat.archived ? 'Restore' : 'Archive'}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* RULE MODAL */}
      {ruleModal.open && (
        <div className="modal-overlay" onClick={() => setRuleModal({ ...ruleModal, open: false })}>
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">{ruleModal.rule ? 'Edit Rule' : 'Add Rule'}</h3>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '2px 8px', minHeight: '28px' }}
                onClick={() => setRuleModal({ ...ruleModal, open: false })}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              {/* Pattern & Mode */}
              <div className="form-group">
                <label className="form-label">Pattern</label>
                <input
                  type="text"
                  className={`form-input ${!rulePatternValidation.ok ? 'error' : ''}`}
                  value={ruleModal.pattern}
                  onChange={(e) => setRuleModal({ ...ruleModal, pattern: e.target.value })}
                  placeholder="e.g. SWIGGY | SWIGGY INSTAMART"
                />
                {!rulePatternValidation.ok ? (
                  <div className="error-msg">{rulePatternValidation.reason}</div>
                ) : (
                  <div style={{ fontSize: '0.75rem', color: 'var(--success)', marginTop: '3px' }}>
                    ✓ Valid pattern
                  </div>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="form-group">
                  <label className="form-label">Mode</label>
                  <select
                    className="form-select"
                    value={ruleModal.mode}
                    onChange={(e) => setRuleModal({ ...ruleModal, mode: e.target.value })}
                  >
                    <option value="words">Words (Substrings)</option>
                    <option value="regex">Regular Expression</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Field</label>
                  <select
                    className="form-select"
                    value={ruleModal.field}
                    onChange={(e) => setRuleModal({ ...ruleModal, field: e.target.value })}
                  >
                    <option value="merchant">merchant</option>
                    <option value="brand">brand</option>
                    <option value="rawText">rawText (Import)</option>
                    <option value="note">note</option>
                  </select>
                </div>
              </div>

              {/* Target Category & Kind */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="form-group">
                  <label className="form-label">Target Category</label>
                  <select
                    className="form-select"
                    value={ruleModal.categoryId}
                    onChange={(e) => setRuleModal({ ...ruleModal, categoryId: e.target.value })}
                  >
                    {activeCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Kind (Optional)</label>
                  <select
                    className="form-select"
                    value={ruleModal.kind}
                    onChange={(e) => setRuleModal({ ...ruleModal, kind: e.target.value })}
                  >
                    <option value="">(Keep incoming)</option>
                    <option value="spend">spend</option>
                    <option value="income">income</option>
                    <option value="transfer">transfer</option>
                    <option value="fixed">fixed</option>
                    <option value="invest">invest</option>
                  </select>
                </div>
              </div>

              {/* Account & Direction Conditions */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="form-group">
                  <label className="form-label">Account (Optional)</label>
                  <select
                    className="form-select"
                    value={ruleModal.accountId}
                    onChange={(e) => setRuleModal({ ...ruleModal, accountId: e.target.value })}
                  >
                    <option value="">(Any Account)</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Direction (Optional)</label>
                  <select
                    className="form-select"
                    value={ruleModal.direction}
                    onChange={(e) => setRuleModal({ ...ruleModal, direction: e.target.value })}
                  >
                    <option value="">(Any Direction)</option>
                    <option value="debit">debit</option>
                    <option value="credit">credit</option>
                  </select>
                </div>
              </div>

              {/* Min/Max Amount */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="form-group">
                  <label className="form-label">Min Amount (₹)</label>
                  <input
                    type="number"
                    className="form-input"
                    value={ruleModal.minRupees}
                    onChange={(e) => setRuleModal({ ...ruleModal, minRupees: e.target.value })}
                    placeholder="None"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Max Amount (₹)</label>
                  <input
                    type="number"
                    className="form-input"
                    value={ruleModal.maxRupees}
                    onChange={(e) => setRuleModal({ ...ruleModal, maxRupees: e.target.value })}
                    placeholder="None"
                  />
                </div>
              </div>

              {/* Priority & Note */}
              <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: '10px' }}>
                <div className="form-group">
                  <label className="form-label">Priority</label>
                  <input
                    type="number"
                    className="form-input"
                    value={ruleModal.priority}
                    onChange={(e) => setRuleModal({ ...ruleModal, priority: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Note</label>
                  <input
                    type="text"
                    className="form-input"
                    value={ruleModal.note}
                    onChange={(e) => setRuleModal({ ...ruleModal, note: e.target.value })}
                    placeholder="e.g. Swiggy food orders"
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="switch-label">
                  <input
                    type="checkbox"
                    checked={ruleModal.active}
                    onChange={(e) => setRuleModal({ ...ruleModal, active: e.target.checked })}
                  />
                  <span>Active rule</span>
                </label>
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setRuleModal({ ...ruleModal, open: false })}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!rulePatternValidation.ok || !ruleModal.categoryId}
                onClick={handleSaveRule}
              >
                Save Rule
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BRAND MODAL */}
      {brandModal.open && (
        <div className="modal-overlay" onClick={() => setBrandModal({ ...brandModal, open: false })}>
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">{brandModal.brand ? 'Edit Brand' : 'Add Brand'}</h3>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '2px 8px', minHeight: '28px' }}
                onClick={() => setBrandModal({ ...brandModal, open: false })}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Brand Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={brandModal.name}
                  onChange={(e) => setBrandModal({ ...brandModal, name: e.target.value })}
                  placeholder="e.g. Swiggy"
                />
              </div>

              <div className="form-group">
                <label className="form-label">Matcher Pattern</label>
                <input
                  type="text"
                  className={`form-input ${!brandPatternValidation.ok ? 'error' : ''}`}
                  value={brandModal.pattern}
                  onChange={(e) => setBrandModal({ ...brandModal, pattern: e.target.value })}
                  placeholder="e.g. SWIGGY | SWIGGY INSTAMART"
                />
                {!brandPatternValidation.ok ? (
                  <div className="error-msg">{brandPatternValidation.reason}</div>
                ) : (
                  <div style={{ fontSize: '0.75rem', color: 'var(--success)', marginTop: '3px' }}>
                    ✓ Valid pattern
                  </div>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="form-group">
                  <label className="form-label">Mode</label>
                  <select
                    className="form-select"
                    value={brandModal.mode}
                    onChange={(e) => setBrandModal({ ...brandModal, mode: e.target.value })}
                  >
                    <option value="words">Words</option>
                    <option value="regex">Regular Expression</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Default Category</label>
                  <select
                    className="form-select"
                    value={brandModal.categoryId}
                    onChange={(e) => setBrandModal({ ...brandModal, categoryId: e.target.value })}
                  >
                    <option value="">(None)</option>
                    {activeCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="form-group">
                  <label className="form-label">Kind (Optional)</label>
                  <select
                    className="form-select"
                    value={brandModal.kind}
                    onChange={(e) => setBrandModal({ ...brandModal, kind: e.target.value })}
                  >
                    <option value="">(None)</option>
                    <option value="spend">spend</option>
                    <option value="income">income</option>
                    <option value="transfer">transfer</option>
                    <option value="fixed">fixed</option>
                    <option value="invest">invest</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Priority</label>
                  <input
                    type="number"
                    className="form-input"
                    value={brandModal.priority}
                    onChange={(e) => setBrandModal({ ...brandModal, priority: e.target.value })}
                  />
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setBrandModal({ ...brandModal, open: false })}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!brandPatternValidation.ok || !brandModal.name.trim()}
                onClick={handleSaveBrand}
              >
                Save Brand
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CATEGORY MODAL */}
      {catModal.open && (
        <div className="modal-overlay" onClick={() => setCatModal({ ...catModal, open: false })}>
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">{catModal.category ? 'Edit Category' : 'Add Category'}</h3>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '2px 8px', minHeight: '28px' }}
                onClick={() => setCatModal({ ...catModal, open: false })}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label className="form-label">Category Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={catModal.name}
                  onChange={(e) => setCatModal({ ...catModal, name: e.target.value })}
                  placeholder="e.g. Groceries"
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="form-group">
                  <label className="form-label">Icon / Emoji</label>
                  <input
                    type="text"
                    className="form-input"
                    value={catModal.icon}
                    onChange={(e) => setCatModal({ ...catModal, icon: e.target.value })}
                    placeholder="🏷️"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Color</label>
                  <input
                    type="color"
                    className="form-input"
                    style={{ height: '44px', padding: '4px' }}
                    value={catModal.color}
                    onChange={(e) => setCatModal({ ...catModal, color: e.target.value })}
                  />
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setCatModal({ ...catModal, open: false })}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!catModal.name.trim()}
                onClick={handleSaveCategory}
              >
                Save Category
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

