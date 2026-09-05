/* コース一覧。ここに追加するとトップページに並ぶ。
   各コースは courses/<id>/ に course.js / questions.js / notes.html（任意で datasets.js）を置く。
   試験日・締切は exams.js から自動で引くので、ここには書かない。questions は一覧・ランディングに出す問題数（目安）。 */
window.COURSE_LIST = [
  { id:'bk3', title:'ビジネス会計検定 3級 合格コース', sub:'12ステップ・要点ノート5章・一問一答＋資料問題・模擬試験', emoji:'📗', questions:151 },
  { id:'bk2', title:'ビジネス会計検定 2級 合格コース', sub:'16ステップ・要点ノート12章・連結の資料問題・模擬試験', emoji:'📘', questions:257 }
];
