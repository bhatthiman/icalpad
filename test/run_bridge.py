import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'src'))
from bridge import icp_run
try:
    print(icp_run(sys.argv[1], sys.stdin.read()))
except Exception as e:
    print('ERR ' + str(e).strip().split('\n')[-1])
