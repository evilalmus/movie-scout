// Test-only preload. No production endpoint or runtime flag enables these fixtures.
globalThis.fetch=async function(input){
 const u=new URL(String(input));let data;
 if(u.hostname==='api.themoviedb.org'){
  if(u.pathname==='/3/movie/popular')data={results:Array.from({length:10},(_,n)=>({id:42+n}))};
  else if(u.pathname==='/3/search/movie'||u.pathname==='/3/discover/movie')data={results:[{id:42,title:'Fixture 42',release_date:'2020-01-01',poster_path:null,overview:'Synthetic test movie.'}]};
  else if(u.pathname==='/3/search/person')data={results:[{id:1,name:'Fixture Actor'}]};
  else {const id=Number(u.pathname.split('/').at(-1));data={id,title:'Fixture '+id,release_date:'2020-01-01',runtime:95,popularity:id,original_language:'en',imdb_id:'tt'+String(id).padStart(7,'0'),overview:'Synthetic test movie.',genres:[{name:'Action'}],credits:{cast:[{id:1,name:'Fixture Actor'}],crew:[{id:2,name:'Fixture Director',job:'Director'}]},release_dates:{results:[{iso_3166_1:'US',release_dates:[{type:3,certification:'R'}]}]}};}
 }else if(u.hostname==='www.omdbapi.com')data={Response:'True',imdbRating:'4.2',Rated:'R',Ratings:[{Source:'Rotten Tomatoes',Value:'30%'}]};
 else if(u.hostname==='guidance.example'){
  const id=Number(u.searchParams.get('tmdb_id'));const evidence={source:'Test fixture',url:'https://guidance.example/title/'+id,checkedAt:new Date().toISOString()};
  data={tmdbId:id,guidance:{violence:{...evidence,scaleMax:10,level:3,present:true},nudity:{...evidence,scaleMax:10,level:2,present:true}},...(id===42?{scores:{audience:90},scoreEvidence:{audience:evidence}}:{})};
 }else throw new Error('Unexpected external request in test: '+u.hostname);
 return Response.json(data);
};
