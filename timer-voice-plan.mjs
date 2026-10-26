export function timerVoicePlan(timer,now=Date.now()){
  const phase=timer.status==='completed'?(timer.phase==='focus'?'break':'focus'):timer.phase;
  const actions=timer.status==='idle'||timer.status==='completed'
    ?['start','pause','resume','completed']
    :timer.status==='paused'?['resume','pause']:['pause','resume'];
  if(timer.status==='running'&&timer.deadline-now<=120000)actions.push('completed');
  return actions.map(action=>({action,phase}));
}

export function invalidatesTimerVoice(action){return ['reset','switch'].includes(action);}
