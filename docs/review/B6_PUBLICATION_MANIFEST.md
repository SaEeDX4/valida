# B6 — publication manifest for GitHub (branch `b6-work`)

| | |
| --- | --- |
| Repository | `SaEeDX4/valida` on GitHub — **public**; remote `main` = `ec15048980c9e3e8134de4b3d7eeadc89b1aef96`; existing branches `a6-work`, `b1-work` … `b5-work`, `main`; **no `b6-work` on the remote** (checked 2026-11-03) |
| Branch | **`b6-work`**, from `ec15048` — the existing naming convention. **Two local commits** in Claude's sandbox clone: `6da01e83958b3d886ca2518eb30382abcfde633d` (r11 — GPT verified its 334 changes) and, on top of it, the r12 documentation commit, whose SHA is in the delivery note and the include-list header (a file cannot contain the hash of its own commit). B7 later goes on its own branch from the accepted `b6-work` |
| State | **Not pushed.** Pushed only after GPT's final recommendation, the owner's explicit B6 acceptance and the owner's authorisation, with a plain `git push origin b6-work` — never a force-push. Merging into `main` is a separate owner step |
| Method | Every path added by an explicit list (`git add --pathspec-from-file`); no `git add -A` or `git add .`; no reset; `.gitignore` unchanged. After the commit, every published file is checked against the private original: identical, or equal to the original with rules P1–P3 applied |
| The owner's own clones | The owner's original workspace holds uncommitted work: `b6-work` is **not** checked out or pulled there; it is fetched into a separate clone |
| Counts | **335 paths published** (added or modified against `ec15048`; nothing deleted), of which **6 are sanitized copies**; **46 withheld** (W1–W5); **32 not published because `.gitignore` excludes them** (`*.log`, Doc 15 §§19–21) |
| Never published | `.env` files (none is present; `backend/.env` is ignored), credentials, `node_modules`, database files, mailbox content |

Private originals — the unsanitized documents, the withheld files and the ignored logs — stay in the review packages and are cited by path and SHA-256 below. Publishing any withheld file later is the owner's choice, as a separate commit.

## Rules

| Rule | Effect |
| --- | --- |
| W1 | Withheld: Owner's desktop screenshots (taskbar, widgets, apps visible) |
| W2 | Withheld: Crops cut from the owner screenshots |
| W3 | Withheld: The owner's messages and ZIP records, preserved byte for byte (the decision records quote them and cite their SHA-256) |
| W4 | Withheld: Output from the owner's machine and copies derived from it (local account paths) |
| W5 | Withheld: Live-run files from the owner's machine with masked mailbox addresses and Message-ID tokens (2026-10-25), and their attribute file |
| `.gitignore` | Not published: `*.log` — sandbox test logs (J1–J8, I0–I8, Stage 2) and the owner's Windows logs |
| P1 | Sanitized copy: every personal Windows profile path (C:\Users\<name>\…) in a document, replaced by `<owner workstation path>` |
| P2 | Sanitized copy: every path in the owner's workspace folder (drive:\ME\…) in a document, replaced by `<owner workspace>` |
| P3 | Sanitized copy: every masked mailbox address at a consumer mail provider in a document, replaced by `<owner test mailbox, masked>` |
| Code | Never transformed. One comment in `backend/src/server.js` names an example path under the owner's workspace; it was already published in `main` at `ec15048` and B6 does not add it |

## Sanitized publication copies (P1–P3)

| Path | Replacements | Private original SHA-256 | Published SHA-256 |
| --- | --- | --- | --- |
| `docs/qa/B6_EVIDENCE_ADDENDUM.md` | P3 ×4 | `0ca8c16015496e9e033704ab18579d6df5b7e1668e12995b689ef3de6d131078` | `c37f5bf6b71e3b33f815e9f2fa4498b1bc33c964d7d3dd039b8407b33044a54e` |
| `docs/qa/b6-3/WINDOWS_EVIDENCE_R6.md` | P1 ×1 | `afb4ad7c4a20dd4f3e71237db873554736420b1e350a593fef5f9ba48ff4d5b1` | `6d8451ff031f2b7fcdf73efe7a3d330f417e628272a8f24762d7ecb62a76ee6c` |
| `docs/qa/b6-stage2/STAGE2_IMPLEMENTATION_REPORT.md` | P3 ×1 | `61b8b2c1e7c5e9cab7a213138bf352bebab02c62384e4b44cb27dcf789fa9cd0` | `3b65c6fb4e0a291d5b228837549add5c03e0f0e251c11c1282f40c18a0f600b6` |
| `docs/qa/b6-stage2/WINDOWS_EVIDENCE_ADDENDUM_2026-10-27.md` | P1 ×3 | `cb507dba44438e8d3dcb51b12b7a51e98b85c0690226ae0f7c8dac184a8685ce` | `a3a934a0bb0476a4b382cbdd03b569af45b331589a33c923bfd2537a01d0c96f` |
| `docs/qa/b6-stage3/LIVE_TEST_PROPOSAL_R1.md` | P2 ×1 | `4933b416c63b3e49af3fa148dd1ed9020b8527ecad890a821d917b392b09534c` | `1044fc777f9c3a31e97b597a41d4d74362205a56c2caaa39ee796c2d889c5b3f` |
| `docs/review/OWNER_RECORD_2026-11-03_B6_R1_LIVE_RUNS.md` | P2 ×2 | `6e945df4a155ff2471a2554eb84e45b06b253de6a716884f515b20c3ac933833` | `00dd8cee4aa1792bc9f2346204b0b1e6a3292e43c7f584b819e3e32bf4ff401f` |

Manifests inside `docs/` that describe the private review packages (for example `docs/qa/b6-stage2/STAGE2_DELTA_MANIFEST.sha256`) list the private originals, so for these files their hashes differ from the published copies by design.

## Sensitive-data check of the publication tree

Run on the tree of the `b6-work` commit (649 files) — the patterns and every remaining hit are in the delivered check log.

| Check | Result |
| --- | --- |
| Personal workstation paths in documentation (P1, P2) | **0** — replaced in 6 sanitized copies. Code: **none introduced by B6**; existing synthetic test inputs and one comment in `backend/src/server.js` were already in `main` |
| Personal mailbox addresses, full or masked; the owner's own address | **0** |
| Owner screenshots and crops, owner messages, owner-machine output, live-run files (W1–W5) | **0** of 78 withheld or ignored paths present; owner screenshots or crops in the tree: 0 |
| `.env` files; real values in `.env.example` | **0** `.env` files; `.env.example` holds names and empty or placeholder values only |
| Private keys; provider token shapes (AWS, GitHub, Slack, Google, API keys) | **0** (the test certificates are generated at run time) |
| Connection strings with credentials | Synthetic test values only — B6 adds 4 (`qa-user:qa-…` in tests), the same pattern as `main` |
| Email addresses outside the company, synthetic and reserved domains, introduced by B6 | **None** — only company mailbox names inside backup-file names (`…@cybervalida.com.pst`) in the backup documents |
| IPv4 addresses, machine names, phone numbers | **None real** — X.509 OIDs, an RFC section number, the V8 version string; synthetic 555-010 numbers |
| Other drive-letter paths introduced by B6 | Generic placeholders (`C:\path\to\valida\backend`, `C:\Users\<name>`) and the prescribed backup folders of the owner's email-backup procedure |

## Withheld (W1–W5)

| Rule | Path | Bytes | SHA-256 |
| --- | --- | --- | --- |
| W4 | `docs/qa/b6-3/evidence/windows/received-vs-original-comparison.DERIVED.txt` | 918 | `4d7881fcc8c9422abc40e4f8cb4c512d07ef78a4bad31129a536545266c56fda` |
| W4 | `docs/qa/b6-3/evidence/windows/verify-b6-r6-windows.ORIGINAL-DECODED.DERIVED.txt` | 51309 | `971c02d6e65374c7ec6f7a6117389cba2f41139da74fad35873ea6d71a45c00d` |
| W4 | `docs/qa/b6-3/evidence/windows/verify-b6-r6-windows.READING-COPY.DERIVED.txt` | 53053 | `e0c2ca4094b64c344d9482463dae5ab57959cc529a6d9f9ba41415390a4750a2` |
| W4 | `docs/qa/b6-stage2/evidence/windows/owner-package-verification-transcript-20261027.txt` | 6301 | `d083d6b18b950dc3a0b856afa697f225543d18144e4c1abf5a71b0d218b22856` |
| W1 | `docs/qa/b6-stage3/evidence/EV-S3-OC1-outlook-classic-offline/original-screenshots/S1-c83e9689-image.png` | 158186 | `6346715e139e0bf105c4bfd9c6069e76088c0c66178c241ba69a7277d65a663a` |
| W1 | `docs/qa/b6-stage3/evidence/EV-S3-OC1-outlook-classic-offline/original-screenshots/S2-9fcbb9cb-image.png` | 152234 | `82bea85a6b4f84801f15477cdc5e57c9287ca0bafc8092c7aaac5b8e4f9a1c1c` |
| W1 | `docs/qa/b6-stage3/evidence/EV-S3-OC1-outlook-classic-offline/original-screenshots/S3-3a183618-image.png` | 5819 | `a3b1bf26ebbca7e38f5e9a746530d4de9ed5ef411c090213ebd4f8f2f9fdb8ec` |
| W1 | `docs/qa/b6-stage3/evidence/EV-S3-OC1-outlook-classic-offline/original-screenshots/S4-e75ba3ba-image.png` | 170271 | `23de9a3621df84fb42e90f748c62b761a6e7fffdfc334d777571b266333412ac` |
| W1 | `docs/qa/b6-stage3/evidence/EV-S3-OC1-outlook-classic-offline/original-screenshots/S5-e052b21d-image.png` | 169591 | `586ec5db3aecc872f87f63eb44cc928954926f569a1f32193c6b4e63b18eb72a` |
| W1 | `docs/qa/b6-stage3/evidence/EV-S3-OC1-outlook-classic-offline/original-screenshots/S6-a7ca6229-image.png` | 186208 | `cfa444f8ae671e51503e5a44e7d339da11686221d8c966f75510684020ad682d` |
| W1 | `docs/qa/b6-stage3/evidence/EV-S3-OC1-outlook-classic-offline/original-screenshots/S7-dc2e8650-image.png` | 184932 | `a767427e521ac60bfeebaa806805277e9bac30b18bdda897941247f9cda3aa4b` |
| W3 | `docs/qa/b6-stage3/evidence/EV-S3-OC1-outlook-classic-offline/owner-instruction-2026-10-27-1610.txt` | 7567 | `7de0a8e512cba0324e6fa3cf696a37c70e22d54cfbee5832264ad85179671659` |
| W1 | `docs/qa/b6-stage3/evidence/EV-S3-OC2-outlook-classic-c2p04-mockups/original-screenshots/M1-67347845-image.png` | 226531 | `66d24d3cc10209ad111f6550dc1182e7ac049cefce3a626ea96a3d92e1fe8c4a` |
| W1 | `docs/qa/b6-stage3/evidence/EV-S3-OC2-outlook-classic-c2p04-mockups/original-screenshots/M2-66d35a91-image.png` | 225722 | `d0fa45cbf3f99c343a221cd69b32e366a05dcd52ccfb37889f1c96a87f509c3f` |
| W1 | `docs/qa/b6-stage3/evidence/EV-S3-OC2-outlook-classic-c2p04-mockups/original-screenshots/M3-e7a21878-image.png` | 282300 | `072a8e51449a3771d50525b7a39dcfa42ca644398f3028d51d200fed771fbaa3` |
| W1 | `docs/qa/b6-stage3/evidence/EV-S3-OC2-outlook-classic-c2p04-mockups/original-screenshots/M4-dbf0529e-image.png` | 280840 | `314eb54a5322670b109441c8bf9d62486ab68eedc99afa8631073febab0b8486` |
| W1 | `docs/qa/b6-stage3/evidence/EV-S3-OC2-outlook-classic-c2p04-mockups/original-screenshots/M5-985e7ca7-image.png` | 279299 | `d21b9ef3d512b6a944befca93674d8fc9c7ab681a3f68f3168e6ed7b1ca637c3` |
| W1 | `docs/qa/b6-stage3/evidence/EV-S3-OC2-outlook-classic-c2p04-mockups/original-screenshots/M6-2d1ecfb1-image.png` | 278924 | `2f4f22829fc765e67a3d5b19d8dc8b6820b023c13f9ab694c5cdc9687e6b2709` |
| W3 | `docs/qa/b6-stage3/evidence/EV-S3-OC2-outlook-classic-c2p04-mockups/owner-instruction-2026-11-01.txt` | 4424 | `52eec6506688656bd251699120f8f7f46e19596d180070a7d7b5e78ca6c3ede4` |
| W1 | `docs/qa/b6-stage3/evidence/EV-S3-OC3-outlook-classic-c2p04-mockups-1to1/original-screenshots/N1-ec1470df-image.png` | 147479 | `7952561bbfba637b63d330c5e1689411eb04050043ec33ea68b1250bec737805` |
| W1 | `docs/qa/b6-stage3/evidence/EV-S3-OC3-outlook-classic-c2p04-mockups-1to1/original-screenshots/N2-8c55b8a2-image.png` | 175883 | `569c8949a4d8f920903776688dac65391c68b4985afb79a1333e513a43ea26fe` |
| W1 | `docs/qa/b6-stage3/evidence/EV-S3-OC3-outlook-classic-c2p04-mockups-1to1/original-screenshots/N3-28899f4e-image.png` | 114920 | `79fa02f1f5eae741b4f41f7f89dfe73a04b0ce60ed32bc42270f0dd5e7e8969f` |
| W1 | `docs/qa/b6-stage3/evidence/EV-S3-OC3-outlook-classic-c2p04-mockups-1to1/original-screenshots/N4-dbdb4c4e-image.png` | 203397 | `ad89ddbdcb8af6b77b3245731669bc6bba3ac8b936ddedeef8df573e37581bbd` |
| W1 | `docs/qa/b6-stage3/evidence/EV-S3-OC3-outlook-classic-c2p04-mockups-1to1/original-screenshots/N5-531c33aa-image.png` | 139283 | `3be6623f7fcf9c38c0a006052822ff6871ad0592a39615276e000dc803d71549` |
| W3 | `docs/qa/b6-stage3/evidence/EV-S3-OC3-outlook-classic-c2p04-mockups-1to1/owner-instruction-2026-11-02.txt` | 9287 | `58aa8bb64e81feb2a94b478da455ecff026968a89fc7a9efb27786943977873b` |
| W2 | `docs/qa/b6-stage3/evidence/EV-S3-OC4-outlook-classic-c2p04-mockup-zoom/derived-title-crops/Z1-title.png` | 6872 | `28ab440e79a6502425e6265cfc091119fbb9103a7ed2488022c71f93d4d59ada` |
| W2 | `docs/qa/b6-stage3/evidence/EV-S3-OC4-outlook-classic-c2p04-mockup-zoom/derived-title-crops/Z2-title.png` | 9488 | `02d98e75229b7df9706826b29f5d66dd63600906cdc2efe50ad26f634d24e2b7` |
| W2 | `docs/qa/b6-stage3/evidence/EV-S3-OC4-outlook-classic-c2p04-mockup-zoom/derived-title-crops/Z3-title.png` | 9488 | `02d98e75229b7df9706826b29f5d66dd63600906cdc2efe50ad26f634d24e2b7` |
| W1 | `docs/qa/b6-stage3/evidence/EV-S3-OC4-outlook-classic-c2p04-mockup-zoom/original-screenshots/Z1-88773f01-image.png` | 1473465 | `7728cd9119c50f4d2b4b236e624e6fdbd3f8488ff62aec065dc610a65bc19731` |
| W1 | `docs/qa/b6-stage3/evidence/EV-S3-OC4-outlook-classic-c2p04-mockup-zoom/original-screenshots/Z2-a1d58126-image.png` | 199679 | `b4d1397f254660e4a580e9fb1bc153ec92a550f3e2333aff31c65bdc61ec7669` |
| W1 | `docs/qa/b6-stage3/evidence/EV-S3-OC4-outlook-classic-c2p04-mockup-zoom/original-screenshots/Z3-a1b8b6fc-image.png` | 182957 | `8fe36c06b2d507b93e34372b4b8a1ba29d005becebc323f635b761726c24d86d` |
| W3 | `docs/qa/b6-stage3/evidence/EV-S3-OC4-outlook-classic-c2p04-mockup-zoom/owner-instruction-2026-11-02-r6-windows-outlook.txt` | 4377 | `d437e4bb7d102f58620b3ce109768002060ae8cc2f96ce1d03b17b711bf858a2` |
| W2 | `docs/qa/b6-stage3/evidence/EV-S3-OC5-outlook-classic-owner-originals-0712/derived-title-crops/O1-subject-line.png` | 3387 | `808cb539f9ae7732662020b7083370fb85fe6a7e1de16b7324b9f4f96aa6bd5d` |
| W2 | `docs/qa/b6-stage3/evidence/EV-S3-OC5-outlook-classic-owner-originals-0712/derived-title-crops/O1-title-bar.png` | 4128 | `0837be140e5b7ec3aa31b06b719131498d94e08b9893fa675e2a0cda400ed1e4` |
| W2 | `docs/qa/b6-stage3/evidence/EV-S3-OC5-outlook-classic-owner-originals-0712/derived-title-crops/O2-subject-line.png` | 4313 | `3106104fd6796fcd32eefe3f6e4b685d2ff5fd456254d5f3136f74c3de0dcaa7` |
| W2 | `docs/qa/b6-stage3/evidence/EV-S3-OC5-outlook-classic-owner-originals-0712/derived-title-crops/O2-title-bar.png` | 7897 | `505d7dc2d729c0d0bc7cf34394795217c61e33f78a577dec821a2485e6a968e4` |
| W2 | `docs/qa/b6-stage3/evidence/EV-S3-OC5-outlook-classic-owner-originals-0712/derived-title-crops/O3-subject-line.png` | 4313 | `3106104fd6796fcd32eefe3f6e4b685d2ff5fd456254d5f3136f74c3de0dcaa7` |
| W2 | `docs/qa/b6-stage3/evidence/EV-S3-OC5-outlook-classic-owner-originals-0712/derived-title-crops/O3-title-bar.png` | 7897 | `505d7dc2d729c0d0bc7cf34394795217c61e33f78a577dec821a2485e6a968e4` |
| W1 | `docs/qa/b6-stage3/evidence/EV-S3-OC5-outlook-classic-owner-originals-0712/original-screenshots/image(20261102-151219).png` | 2191567 | `7e95b039f3fbcb2ed92bac71e28028d67123db48a963c85d9b6d1bf99722b797` |
| W1 | `docs/qa/b6-stage3/evidence/EV-S3-OC5-outlook-classic-owner-originals-0712/original-screenshots/image(20261102-151223).png` | 197192 | `88f9c609fccd81fa1edbad1e7893641f5f9885a95a123d886255d8dd76acf680` |
| W1 | `docs/qa/b6-stage3/evidence/EV-S3-OC5-outlook-classic-owner-originals-0712/original-screenshots/image(20261102-151235).png` | 179524 | `a1f8cbfb4c018fad0de77c4a4dd6b64f307f15dd4f597285312fdadba8332985` |
| W5 | `docs/qa/evidence/.gitattributes` | 243 | `abe283fd7f2c90794bd76498c7595f2980575755c64b87ca92c92b8845b1802e` |
| W5 | `docs/qa/evidence/b6-r9/B6-r9-Titan-bounce-20261025-093226-736-evidence.json` | 6461 | `e91ed831c28670f703e07e86d2f3930a67aadca99759da0f0077c7e72534049d` |
| W5 | `docs/qa/evidence/b6-r9/B6-r9-Titan-live-20261025-091817-492-evidence.json` | 4792 | `ba22d91f200c23fe90dd212d42cb78e0086698419ef35ff16384f5dec99a9755` |
| W3 | `docs/review/owner-sources/OD-2026-11-02-02/B6_D6_OWNER_DECISION_AND_EVIDENCE_RECONCILIATION.md` | 8228 | `6bbe68842afd4581fc62d3ce35af9e1423fcf8fa0b81f75e3b4dac95dad3b9d0` |
| W3 | `docs/review/owner-sources/OD-2026-11-02-03/owner-instruction-2026-11-02-b6-offline-completion.txt` | 5826 | `4bec67a51b569e922474bcbda74d2b45f69943732a35b5726ad4e1e51e8b7030` |

## Not published — ignored by `.gitignore`

| Path | Bytes | SHA-256 |
| --- | --- | --- |
| `docs/qa/b6-3/evidence/J1-focused-verbose.log` | 61003 | `078297215f31e03507e366e634b67285f01718e2ca8a47539ab8e960b282e34c` |
| `docs/qa/b6-3/evidence/J2-verify-b6.log` | 3679 | `61d2725a33e357aa3fe980d9122773e5eaa62fc0be2823a9b1063fc250ed14c0` |
| `docs/qa/b6-3/evidence/J3-mutation-checks.log` | 6706 | `51c4901b4fa1efd14ef7717759aa22b9a362e2434d22d031c1ed4a583d12fc92` |
| `docs/qa/b6-3/evidence/J4-asset-mismatch-probe.log` | 941 | `c5fe1264de49dc16c53bb6cfa2681c3a947a2a10a0d27b682af412bc11472c94` |
| `docs/qa/b6-3/evidence/J5-fixtures.log` | 3642 | `8bacb3e0480d7fcbacd2b40524aaf38d18baa07590aa5a4a8a69707a4d696cbe` |
| `docs/qa/b6-3/evidence/J6-previews.log` | 16932 | `36e4864ff1d72fbf0d72cb39ffafd1a5e9ea66c17093eef6cc1cf31695ce4b67` |
| `docs/qa/b6-3/evidence/J7-word-constraint-model.log` | 7333 | `33b8be7247378dc69011e46a96662535d934b850b6b270737271bfa69e1918cf` |
| `docs/qa/b6-3/evidence/J8-negative-control.log` | 2490 | `f7a4109dfa325e7ec1109b6ac4a5b4a08b5b21e6073d07f61554178b20fa7bf0` |
| `docs/qa/b6-3/evidence/J8-offline-inspection.first-run-tool-defects.log` | 13359 | `e2a4beeb8741602856ae0e5eb33cc3a8e7e55ddd46667a27c9e670145f48c4ac` |
| `docs/qa/b6-3/evidence/J8-offline-inspection.log` | 13123 | `aa0f8b666765a4d0088e298ae29d0af65e719406b73cc7162d9be479ca5dbcc4` |
| `docs/qa/b6-3/evidence/windows/verify-b6-r6-windows.RECEIVED-COPY.log` | 68336 | `646223480910f446a7c554aa376d8fa0e2867fa82a6e6a5cf9832ce8727437ea` |
| `docs/qa/b6-3/evidence/windows/verify-b6-r6-windows.log` | 130070 | `f1b4ee6622aea254f032d2ce65d43fa432fe603c30390ff4fe635634bc97e897` |
| `docs/qa/b6-stage2/evidence/baseline-offline.log` | 5274 | `d99282c26f7817c08d1e0fda20453cdc5129a4008f04ffa63b5e195c43ed04a0` |
| `docs/qa/b6-stage2/evidence/integrated/I0-patch-apply.log` | 3330 | `cc0f1d7a04d60717524002900a7e3aa0db727008085e44f575c2c7abc6cb8ab8` |
| `docs/qa/b6-stage2/evidence/integrated/I1-focused-verbose.log` | 60444 | `3f4103c2ef9125757c99f6c72db2caeb28a8da5fe777b2f62d71f53268e18b43` |
| `docs/qa/b6-stage2/evidence/integrated/I2-verify-b6.log` | 3691 | `f96f9cae61815b1dc2d80849266800893d1091bbe36679d234e540da04af7665` |
| `docs/qa/b6-stage2/evidence/integrated/I3-mutation-checks.log` | 4008 | `060d585644f3d67bc41cab2039efa9f572a267a4a9e006e36c39f6e9771c9e28` |
| `docs/qa/b6-stage2/evidence/integrated/I4-logo-mismatch-probe.log` | 970 | `75d0a7716c71f0fba7facb869006aa31bb775f11f691697b20d7a259a309d948` |
| `docs/qa/b6-stage2/evidence/integrated/I5-rehearsal-assertion-probe.log` | 817 | `1b68befec30c053b6027f61b2d16215200f80f241977bd608776688a3e65b901` |
| `docs/qa/b6-stage2/evidence/integrated/I6-node-check.log` | 839 | `7ade467828176892c335785ceacef0ed23ac212591cbdf55086db2dc93724584` |
| `docs/qa/b6-stage2/evidence/integrated/I7-fixtures.log` | 4412 | `8abb3378ea05675bba3fb2a88068430963e7408acab62bf2f84c4fad90afa514` |
| `docs/qa/b6-stage2/evidence/integrated/I8-previews.log` | 1806 | `24374f71218d5d4a27c4139fbda56bef9e65391950aca88d0e0de110ec2264ae` |
| `docs/qa/b6-stage2/evidence/mutation-checks.log` | 2746 | `ce2b5afd67f602367d64c032ae4b4b5896ba86e7f87887ecc0acb17f70e726ed` |
| `docs/qa/b6-stage2/evidence/node-check.log` | 561 | `f92e8c3384b76f461b72fa7320ed3296681bfac529fdd75efabcb51a8d4bcdba` |
| `docs/qa/b6-stage2/evidence/npm-ci-backend.log` | 276 | `ed6a022c1b97c4fef65b9dda5c1a0de2baa4e90ab280c512b909e09144d40c6c` |
| `docs/qa/b6-stage2/evidence/patch-apply-check.log` | 951 | `9f7e972f78ed5d718bb06c3400a30eedbae3ec7d7ed986df79308b7c6aef9ed0` |
| `docs/qa/b6-stage2/evidence/patch-scratch-vs-current.log` | 2002 | `010319174ee5d328b1b4edc9316d40a43ca040d88781ecc5f7c8e8049d46ce5c` |
| `docs/qa/b6-stage2/evidence/patch-validate-offline.log` | 215 | `f5b61dd9610d034bbf4ee14971f9d7d03d58e8b31e3944ed3ad00922007c1976` |
| `docs/qa/b6-stage2/evidence/rehearsal-assertion-probe.log` | 576 | `3d460f7c953d600ee01d50e6a476bf2722cf485de4fd6ef6074c9047b3acb3e2` |
| `docs/qa/b6-stage2/evidence/verify-b6-stage2.log` | 3364 | `4fbbd2a37ae1dc822521fb043bcab463c3991d68620d497ad349ab3df59b88ee` |
| `docs/qa/b6-stage2/evidence/windows/dep0190-trigger-probe.log` | 883 | `643e8db849757cde8fea9d25a4954f6bfa6f775dc3110f72c547cd8e0ab5c406` |
| `docs/qa/b6-stage2/evidence/windows/verify-b6-stage2-logo-windows-20261027-050012.log` | 60295 | `d0b3bc71d45e54c8c3259dd4ddb36cd4ce486765221861ddb73f50d9bc115cb5` |

## Published

Everything else that differs from `ec15048`: the backend code, tests, scripts and the masthead asset; `backend/README.md`, `backend/.env.example`, `backend/package.json` and the lockfile; the root `README.md`; and the B6 records under `docs/`. The exact list with published SHA-256 values is the commit itself and the include list delivered with the review package.
