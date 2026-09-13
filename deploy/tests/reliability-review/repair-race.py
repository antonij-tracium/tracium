import datetime
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[3]
REPORT = Path(os.environ.get('RELIABILITY_REPORT_DIR', ROOT / 'deploy/reports/reliability-2026-09-07'))
REPORT.mkdir(parents=True, exist_ok=True)
script = (ROOT / 'deploy/scripts/repair-rollup.sh').read_text()
columns = script.split('EXPECTED_COLUMNS="', 1)[1].split('"', 1)[0]
today = datetime.datetime.now(datetime.timezone.utc).date().isoformat()

transport = '''#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
path=Path(os.environ['REPAIR_REVIEW_STATE'])
state=json.loads(path.read_text())
sql=sys.argv[sys.argv.index('--data-binary')+1]
state['queries'].append(sql)
compact=' '.join(sql.split())
if 'SELECT engine, sorting_key' in compact:
    result='AggregatingMergeTree\\tbucket_date, user_id, workspace_id, workflow_name, model'
elif 'SELECT name, type FROM system.columns' in compact:
    result=state['columns']
elif 'SELECT as_select FROM system.tables' in compact or compact.startswith('EXPLAIN SYNTAX'):
    result='SELECT identical_schema_fixture'
elif compact.startswith("SELECT dateDiff('day'"):
    result='0'
elif compact.startswith('SELECT toString(toDate('):
    result=state['day']
elif compact.startswith('SELECT count(), countDistinct('):
    result=f"{state['raw']}\\t1\\t{state['day']}\\t{state['day']}\\t{state['raw']}\\t600"
elif compact.startswith('SELECT sum(cost), sum(span_count)'):
    result=f"{state['rollup']}\\t{state['rollup']}"
elif compact.startswith('ALTER TABLE tracium.metrics_daily DELETE'):
    state['rollup']=0
    if state['late_arrival']:
        state['raw']+=1
        state['rollup']+=1
    result=''
elif compact.startswith('INSERT INTO tracium.metrics_daily'):
    state['rollup']+=state['raw']
    result=''
else:
    print('Unexpected query in offline transport fixture',file=sys.stderr)
    sys.exit(2)
path.write_text(json.dumps(state))
print(result+'\\n200',end='')
'''

results = []
with tempfile.TemporaryDirectory(prefix='tracium-repair-review-') as temporary:
    directory = Path(temporary)
    curl = directory / 'curl'
    curl.write_text(transport)
    curl.chmod(0o700)
    for late_arrival in (False, True):
        state_path = directory / 'state.json'
        state_path.write_text(json.dumps({
            'raw': 1, 'rollup': 1, 'day': today, 'columns': columns,
            'late_arrival': late_arrival, 'queries': [],
        }))
        environment = {**os.environ, 'PATH': str(directory) + os.pathsep + os.environ['PATH'],
                       'REPAIR_REVIEW_STATE': str(state_path), 'CLICKHOUSE_PASSWORD': 'review-placeholder',
                       'CLICKHOUSE_DB': 'tracium', 'CLICKHOUSE_HTTP': 'http://unused.invalid',
                       'QUIESCE_SECONDS': '300'}
        completed = subprocess.run(['bash', str(ROOT / 'deploy/scripts/repair-rollup.sh'),
                                    '--from', today, '--yes'], env=environment,
                                   text=True, capture_output=True, timeout=15)
        state = json.loads(state_path.read_text())
        label = 'race' if late_arrival else 'control'
        (REPORT / ('repair-' + label + '.txt')).write_text(completed.stdout + completed.stderr)
        results.append({'scenario': label, 'exit_code': completed.returncode,
                        'raw_spans': state['raw'], 'rollup_spans': state['rollup'],
                        'current_day': today, 'force_flag_used': False})

assert results[0]['exit_code'] == 0 and results[0]['rollup_spans'] == 1, results
assert results[1]['exit_code'] == 0 and results[1]['raw_spans'] == 2 and results[1]['rollup_spans'] == 3, results
report = {'method': 'Real repair script with offline curl fixture simulating one arrival and its materialized-view contribution between DELETE and INSERT. No database or network access.',
          'confirmed_control_flow_race': True, 'scenarios': results}
(REPORT / 'repair-race.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
