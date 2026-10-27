"""Rebuild Phone_Twin_Project.toe from build_phonetwin_td.py + td_core.py with the installed TouchDesigner.

  py make_toe.py --src <existing .toe> --out <.toe to write>

How: the source .toe is expanded to text (toeexpand), an Execute DAT 'bootstrap' is added to /project1 that runs
build_phonetwin_td.py on start, it is collapsed again (toecollapse) and opened in TouchDesigner. The build script
creates the network, lets it run ~1.5 s, removes 'bootstrap', saves to --out and quits. Its log is printed.
"""
import argparse
import os
import shutil
import struct
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
TD_BIN = r'C:\Program Files\Derivative\TouchDesigner\bin'

BOOT = '''def onStart():
	import os
	path = os.environ['PT_TD_BUILD']
	g = dict(globals())
	g['__file__'] = path
	exec(compile(open(path, encoding='utf-8').read(), path, 'exec'), g)
	return
'''


def dat_text(s):
	"""Text DAT contents as stored in an expanded .toe: '2\\n*', five big-endian ints, length, UTF-8 text."""
	b = s.encode('utf-8')
	return b'2\n*' + struct.pack('>5I', 1, 1, 1, 1, 2) + struct.pack('>I', len(b)) + b


def main():
	ap = argparse.ArgumentParser()
	ap.add_argument('--src', required=True)
	ap.add_argument('--out', required=True)
	ap.add_argument('--work', default=os.path.join(os.environ.get('TEMP', '.'), 'pt_td_build'))
	ap.add_argument('--timeout', type=float, default=180)
	a = ap.parse_args()

	shutil.rmtree(a.work, ignore_errors=True)
	os.makedirs(a.work)
	boot = os.path.join(a.work, 'boot.toe')
	shutil.copy(a.src, boot)
	subprocess.run([os.path.join(TD_BIN, 'toeexpand.exe'), 'boot.toe'], cwd=a.work)
	d = boot + '.dir'
	os.makedirs(os.path.join(d, 'project1'), exist_ok=True)
	with open(os.path.join(d, 'project1', 'bootstrap.n'), 'w', newline='\n') as f:
		f.write('DAT:execute\ntile 400 400 130 90\nflags =  viewer 1 parlanguage 0\ncolor 0.67 0.67 0.67 \nend\n')
	with open(os.path.join(d, 'project1', 'bootstrap.parm'), 'w', newline='\n') as f:
		f.write('?\nstart 0 on\n?\n')
	with open(os.path.join(d, 'project1', 'bootstrap.text'), 'wb') as f:
		f.write(dat_text(BOOT))
	toc = boot + '.toc'
	lines = open(toc, encoding='utf-8').read().splitlines()
	lines = [l for l in lines if not l.startswith('project1/bootstrap.')]
	i = lines.index('project1.panel') + 1
	lines[i:i] = ['project1/bootstrap.n', 'project1/bootstrap.parm', 'project1/bootstrap.text']
	open(toc, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines) + '\n')
	start = os.path.join(d, '.start')
	s = [l for l in open(start, encoding='utf-8').read().splitlines() if not l.startswith('#expectednodes')]
	open(start, 'w', encoding='utf-8', newline='\n').write('\n'.join(s) + '\n')
	os.remove(boot)
	subprocess.run([os.path.join(TD_BIN, 'toecollapse.exe'), 'boot.toe'], cwd=a.work)
	if not os.path.exists(boot):
		sys.exit('toecollapse failed')

	log = os.path.join(a.work, 'build.log')
	out_tmp = os.path.join(a.work, 'built.toe')
	env = dict(os.environ, PT_TD_BUILD=os.path.join(HERE, 'build_phonetwin_td.py'), PT_TD_CORE=os.path.join(HERE, 'td_core.py'),
	           PT_TD_OUT=out_tmp, PT_TD_LOG=log, PT_TD_SNAP=os.path.join(a.work, 'snapshot.png'))
	p = subprocess.Popen([os.path.join(TD_BIN, 'TouchDesigner.exe'), boot], env=env, cwd=a.work)
	t0 = time.time()
	while p.poll() is None and time.time() - t0 < a.timeout:
		time.sleep(1)
	if p.poll() is None:
		p.kill()
		print('TouchDesigner did not quit in time (killed)')
	print(open(log, encoding='utf-8').read() if os.path.exists(log) else '(no build log — the bootstrap did not run)')
	if not os.path.exists(out_tmp):
		sys.exit('no .toe was saved')
	shutil.copy(out_tmp, a.out)
	print('wrote', a.out)


if __name__ == '__main__':
	main()
