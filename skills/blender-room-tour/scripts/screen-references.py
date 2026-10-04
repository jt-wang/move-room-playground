#!/usr/bin/env python3
"""Copy only visually approved references into a new still-image agent job. No uploads.

The new job is kind "stills": it never needs, names or claims review of the raw
video. Only the video's SHA-256, duration and extraction method remain as
provenance; the video path, stream tags and unselected frames are not copied.
"""
from pathlib import Path
import argparse,hashlib,json,shutil,sys
sys.path.insert(0,str(Path(__file__).resolve().parent))
from blender_tour_flow.prepare import stills_sheet, write_authoring_files
p=argparse.ArgumentParser(description=__doc__);p.add_argument('job',type=Path);p.add_argument('--keep',required=True,help='comma-separated frame filenames, after visual privacy review');p.add_argument('--out',type=Path,required=True);a=p.parse_args()
source=a.job.resolve();out=a.out.absolute()
if out.exists() or out.is_symlink():p.error('Output must not exist')
meta=json.loads((source/'metadata.json').read_text());requested=a.keep.split(',')
if len(set(requested))!=len(requested) or any(Path(n).name!=n for n in requested):p.error('Use unique filenames only')
frames=[f for f in meta['frames'] if Path(f['path']).name in requested]
if len(frames)!=len(requested) or not frames:p.error('Every selected name must match an extracted frame')
for f in frames:
 path=source/f['path']
 if path.is_symlink() or not path.resolve().is_relative_to(source/'references') or not path.is_file():p.error('Invalid reference path')
(out/'references').mkdir(parents=True)
kept=[]
for f in frames:
 shutil.copyfile(source/f['path'],out/f['path'])
 kept.append({'path':f['path'],'sha256':hashlib.sha256((out/f['path']).read_bytes()).hexdigest(),'timestamp_seconds':f.get('timestamp_seconds'),**({'actual_timestamp_seconds':f['actual_timestamp_seconds']} if 'actual_timestamp_seconds' in f else {})})
video=meta.get('source') or {}
screened={'schema_version':2,'kind':'stills','input_scope':'screened_stills','source':None,'status':'references_ready','frames':kept,
 'provenance':{'video_sha256':video.get('sha256'),'duration_seconds':video.get('duration_seconds'),'decoder':meta.get('decoder'),'tonemapping':meta.get('tonemapping')},
 'privacy_screening':{'method':'User/agent visual selection; command does not detect faces or text','kept':requested,'raw_video_copied':False}}
# Fresh templates: the build gate refuses them until the author has edited them.
screened['templates']=write_authoring_files(out,'screened_stills')
(out/'metadata.json').write_text(json.dumps(screened,indent=2)+'\n')
(out/'reference-sheet.html').write_text(stills_sheet(kept,'Screened references'))
print(f'{len(frames)} selected frames copied to {out}; original video not copied or required. Selection is a review claim, not automatic privacy detection.')
