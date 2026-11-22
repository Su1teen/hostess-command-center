/**
 * ES3 inline check. Browsers that cannot run this app (no ES modules, no oklch /
 * cascade layers that Tailwind v4 needs) are sent to /lite. `?full=1` opts out
 * for this browser (remembered in a cookie); modern browsers never redirect.
 */
export const LEGACY_REDIRECT = `(function(){try{var l=window.location,d=document;if(/[?&]full=1/.test(l.search)){d.cookie="hostess-full=1; path=/; max-age=31536000";return}if(d.cookie.indexOf("hostess-full=1")>=0)return;var s=d.createElement("script"),c=window.CSS;if(!("noModule" in s)||!c||!c.supports||!c.supports("color","oklch(0.5 0.1 200)")||!c.supports("(color: color-mix(in srgb, red, blue))")){l.replace("/lite")}}catch(e){}})();`;
