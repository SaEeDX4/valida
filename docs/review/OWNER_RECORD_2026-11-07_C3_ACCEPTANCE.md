# Owner record — C3 accepted at `f07ea35` (2026-11-07)

| | |
| --- | --- |
| Source | The owner's C4 instruction ("Valida — C4 implementation and C1–C3 publication-readiness audit"), received 2026-11-07 (UTC) |
| Recorded by | Claude, in the first C4 documentation commit on `c4-work` |
| Nature | A record of decisions already made by the owner. It decides nothing new |

## Accepted checkpoints, as stated by the owner

| Milestone | State | Commit |
| --- | --- | --- |
| B7 | accepted and published | `eabd604f2c17ab318898cf0627025510a3c26322` |
| C1 | accepted | `24b92a7d3f07cf42be274cf35fdb8cdbc7c504b3` |
| C2 | accepted | `46818bb48cb3cfcc4abffcef58daf759a5bf1ce1` |
| C3 | accepted | `f07ea35f6f2995d760bf06e8b5080187270e110e` |

- **Frozen publication range:** `eabd604..f07ea35`, exactly 18 Release C commits.
- **Accepted C3 r3 bundle SHA-256:** `0b7293bdb3f2d764a7ed28f75bb2c430a649e190518b429ceb3c262068cd369b`.
- **Proposed publication destination:** `refs/heads/c3-work` on `https://github.com/SaEeDX4/valida.git`.

## The four states, kept separate

| | C1 | C2 | C3 |
| --- | --- | --- | --- |
| Accepted | yes, `24b92a7` | yes, `46818bb` | **yes, `f07ea35`** (this record) |
| Branch-published | no | no | no. A readiness audit and a push plan were prepared; the push is **not authorised** and was not run |
| Merged into `main` | no | no | no |
| Deployed | no | no | no |

The C1 and C2 commits are published only as part of `c3-work`, because `c3-work` contains them. Publication changes only after the owner authorises the push and the remote branch and SHA are verified. Merging and deployment are separate owner decisions.

## Consequences in this repository

- C4 starts at `f07ea35`. `c3-work` stays fixed at `f07ea35`.
- `README.md` shows C3 as accepted, and C4 as submitted for review.
- At the frozen tip, C3 is described as "submitted for review" and C1–C3 as "local only". That was accurate when written and is **not** rewritten: the accepted history is preserved exactly. This record and the C4 README supersede it.
