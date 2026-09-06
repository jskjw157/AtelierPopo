import { useEffect, useRef, useState } from 'react';
import { FileImage, Film, RefreshCw, UploadCloud } from 'lucide-react';
import { api, formatBytes, formatDate } from '../lib/api.js';
import EmptyState from '../components/EmptyState.jsx';

export default function LibraryPage() {
  const input = useRef(null);
  const [media, setMedia] = useState([]);
  const [altText, setAltText] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  async function load(){try{setMedia((await api('/api/media')).media);setError('')}catch(e){setError(e.message)}}
  useEffect(()=>{load()},[]);
  async function upload(event){event.preventDefault();const file=input.current?.files?.[0];if(!file)return;setUploading(true);setError('');setMessage('');const body=new FormData();body.append('file',file);body.append('altText',altText);try{await api('/api/media',{method:'POST',body});setMessage('미디어를 저장했습니다.');input.current.value='';setAltText('');await load()}catch(e){setError(e.message)}finally{setUploading(false)}}
  return <div className="page-wrap"><header className="page-header"><div><span className="eyebrow">ASSET LIBRARY</span><h1>미디어 라이브러리</h1><p>원본 파일은 비공개로 저장하고, 발행 시에만 만료되는 서명 URL을 생성합니다.</p></div><button className="button button-secondary" onClick={load}><RefreshCw size={16}/>새로고침</button></header>
    <section className="panel upload-panel"><form onSubmit={upload}><div className="upload-drop"><UploadCloud size={28}/><div><strong>이미지 또는 영상 업로드</strong><p>JPEG, PNG, WebP, MP4, MOV · 최대 100MB(서버 설정 기준)</p></div><input ref={input} type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" required/></div><label>대체 텍스트<input value={altText} onChange={(e)=>setAltText(e.target.value)} placeholder="제품과 장면을 구체적으로 설명"/></label><button className="button button-primary" disabled={uploading}>{uploading?'업로드 중…':'라이브러리에 저장'}</button></form></section>
    {error?<div className="alert alert-error">{error}</div>:null}{message?<div className="alert alert-success">{message}</div>:null}
    {media.length?<section className="media-grid">{media.map((asset)=><article className="media-card" key={asset.id}><div className="media-preview">{asset.media_type==='image'?<img src={`/api/media/${asset.id}/preview`} alt={asset.alt_text||asset.original_name}/>:<video src={`/api/media/${asset.id}/preview`} controls preload="metadata"/>}<span className="media-kind">{asset.media_type==='image'?<FileImage size={14}/>:<Film size={14}/>}</span></div><div className="media-meta"><strong title={asset.original_name}>{asset.original_name}</strong><span>{asset.width&&asset.height?`${asset.width} × ${asset.height}`:'크기 정보 없음'} · {formatBytes(asset.bytes)}</span><small>{formatDate(asset.created_at)}</small>{asset.alt_text?<p>{asset.alt_text}</p>:<p className="muted">대체 텍스트 없음</p>}</div></article>)}</section>:<EmptyState title="저장된 미디어가 없습니다" description="첫 제품 이미지나 릴스 영상을 업로드해 주세요."/>}
  </div>
}
