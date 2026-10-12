// Чистый плеер без служебных надписей go2rtc.
import { VideoRTC } from '/player/video-rtc.js';

class LivePlayer extends VideoRTC {
  oninit() {
    super.oninit();
    this.video.controls = false;
    this.video.muted = true;
    this.video.playsInline = true;
  }
}
customElements.define('video-live', LivePlayer);
