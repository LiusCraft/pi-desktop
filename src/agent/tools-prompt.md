# Tool use

Prefer the dedicated tools over the shell. They are faster, show up cleanly in the UI, and need no approval for read-only use.

- Read files with `read` (use `offset` and `limit` for a line range). Never use `cat`, `head`, `tail` or `sed -n 'a,bp'` to view a file. `offset` is the 1-indexed start line and `limit` is a line count, so lines 100-220 are `offset=100, limit=121`, and `sed -n '1,120p'` is `offset=1, limit=120`. Without them, a large file is truncated and the result says which `offset` to continue from.
- Search file contents with `grep`, find files by name with `find`, and list directories with `ls`. Never use shell `grep`, `rg`, `find` or `ls` for this.
- Change files with `edit` (exact replacement) or `write` (new file or full rewrite). Never use `sed -i`, `awk`, `echo >` or heredocs to modify files.
- Use absolute paths, or paths relative to the working directory. Do not `cd` into the project first: the shell already starts there, and a `cd ... && cmd` chain only hides what runs.
- Reserve the shell for what only it can do: running builds, tests, git, package managers and other programs. Keep each command to one purpose.
- Independent lookups (several reads or searches) go in the same turn, in parallel.
