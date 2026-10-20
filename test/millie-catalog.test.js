import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MILLIE_VERIFIED_TITLES,
  normalizeBookTitle,
  isVerifiedMillieTitle,
  applyVerifiedMillieStatus,
} from '../src/millie-catalog.js';

test('옵시디언 검수 목록은 중복을 제거한 121권이다', () => {
  assert.equal(MILLIE_VERIFIED_TITLES.length, 121);
  assert.equal(new Set(MILLIE_VERIFIED_TITLES).size, 121);
});

test('제목의 유니코드 공백과 앞뒤 공백을 정규화해 정확히 매칭한다', () => {
  assert.equal(
    normalizeBookTitle(' 지적 대화를 위한 넓고 얕은 지식 1\u00a0- 현실 편 : 역사 / 경제 / 정치 / 사회 / 윤리 '),
    normalizeBookTitle('지적 대화를 위한 넓고 얕은 지식 1 - 현실 편 : 역사 / 경제 / 정치 / 사회 / 윤리'),
  );
  assert.equal(isVerifiedMillieTitle('세이노의 가르침'), true);
  assert.equal(isVerifiedMillieTitle('세이노의 가르침 2'), false);
});

test('확인 전인 책만 검수 목록과 일치하면 밀리 완전판으로 표시한다', () => {
  assert.equal(applyVerifiedMillieStatus({ title: '세이노의 가르침', millieStatus: 'unchecked' }), 'full');
  assert.equal(applyVerifiedMillieStatus({ title: '세이노의 가르침', millieStatus: 'not_found' }), 'not_found');
  assert.equal(applyVerifiedMillieStatus({ title: '목록에 없는 책', millieStatus: 'unchecked' }), 'unchecked');
});
