import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { compile } from '@inlang/paraglide-js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

await compile({
	project: path.join(projectRoot, 'project.inlang'),
	outdir: path.join(projectRoot, 'src/lib/paraglide'),
	emitTsDeclarations: true
});
