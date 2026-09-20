import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

// O `dist` é versionado: os consumidores instalam este repositório por tag do git,
// e sem artefato pronto o pnpm precisaria rodar `prepare`, o que exige declarar o
// pacote em `allowBuilds` com o SHA exato do commit, em cada consumidor, a cada tag.
//
// O preço de versionar o artefato é ele envelhecer sem ninguém perceber. Esta trava
// é o que torna o preço aceitável: recompila em um diretório temporário e compara
// arquivo por arquivo. Se alguém alterar `src` e esquecer de rodar `pnpm build`,
// a suíte quebra aqui, e não silenciosamente na máquina de quem consome.

const files = (root: string): string[] =>
  readdirSync(root).flatMap((entry) => {
    const full = join(root, entry);
    return statSync(full).isDirectory() ? files(full) : [full];
  });

test('o dist versionado corresponde ao que o src compila hoje', () => {
  const out = mkdtempSync(join(tmpdir(), 'pulso-dist-'));
  try {
    // O compilador é chamado pelo seu próprio entrypoint JS, e não pelo `tsc` da
    // linha de comando: o Node no Windows recusa spawn de `.cmd` sem shell.
    const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
    execFileSync(process.execPath, [tsc, '-p', 'tsconfig.build.json', '--outDir', out], {
      stdio: 'pipe',
    });
    const esperados = files(out).map((f) => relative(out, f).split(sep).join('/')).sort();
    const atuais = files('dist').map((f) => relative('dist', f).split(sep).join('/')).sort();
    assert.deepEqual(
      atuais,
      esperados,
      'A lista de arquivos em dist/ não bate com a compilação. Rode `pnpm build` e comite o resultado.',
    );
    for (const nome of esperados) {
      // Os .map carregam o caminho absoluto do outDir, que muda a cada execução.
      if (nome.endsWith('.map')) continue;
      assert.equal(
        readFileSync(join('dist', nome), 'utf8'),
        readFileSync(join(out, nome), 'utf8'),
        `dist/${nome} está desatualizado. Rode \`pnpm build\` e comite o resultado.`,
      );
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
