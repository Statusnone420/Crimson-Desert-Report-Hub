import { describe, expect, it } from 'vitest';
import { blankDraft, formatDraft, validateDraft } from '../prototypes/newspaper/app/report/form-draft.mjs';

const valid = { ...blankDraft, platform:'pc_steam', category:'controls_gameplay', severity:'medium', frequency:'always', issue_title:'Opening the map freezes the game', description:'The game freezes when I open the map while in combat near the camp.' };

describe('local report draft contract', () => {
  it('uses the live schema and preserves an explicit false checkbox', () => {
    const result = validateDraft({...valid,issue_title:`  ${valid.issue_title}  `});
    expect(result.errors).toEqual({});
    expect(result.data?.issue_title).toBe(valid.issue_title);
    expect(result.data?.official_report_submitted).toBe(false);
    expect(result.data?.hardware_specs).toBeNull();
  });
  it('rejects unsupported options, vague short text and executable evidence URLs', () => {
    const result = validateDraft({...valid,platform:'invented',description:'bug',evidence_url:'javascript:alert(1)'});
    expect(result.data).toBeNull();
    expect(Object.keys(result.errors)).toEqual(expect.arrayContaining(['platform','description','evidence_url']));
  });
  it('validates optional caps even when fields are collapsed', () => {
    expect(validateDraft({...valid,hardware_specs:'x'.repeat(501)}).errors).toHaveProperty('hardware_specs');
  });
  it('formats only validated report fields into a copyable draft', () => {
    const result = validateDraft({...valid,untrusted_extra:'must not copy',evidence_url:'https://example.com/evidence'});
    const text = formatDraft(result.data!);
    expect(text).toContain('Platform: PC (Steam)');
    expect(text).toContain('Evidence link: https://example.com/evidence');
    expect(text).toContain('Also reported to Pearl Abyss: No');
    expect(text).not.toContain('must not copy');
    expect(text).not.toContain('Hardware:');
  });
});
