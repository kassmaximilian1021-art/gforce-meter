async function handleAudioToggle() {
  const isOn = dom.toggleAudio.classList.toggle('active');
  dom.toggleAudio.setAttribute('aria-checked', isOn);
  audio.setEnabled(isOn);
  if (isOn) {
    await audio.initFromUserGesture();
  }
}
