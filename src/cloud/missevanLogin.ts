type GeetestValidate = {
  geetest_challenge: string;
  geetest_validate: string;
  geetest_seccode: string;
};

type GeetestInstance = {
  appendTo: (target: string | HTMLElement) => void;
  getValidate: () => GeetestValidate | false;
  onError: (callback: () => void) => void;
  onClose: (callback: () => void) => void;
  onSuccess: (callback: () => void) => void;
  verify: () => void;
  destroy?: () => void;
};

type GeetestOptions = {
  gt: string;
  challenge: string;
  offline: boolean;
  new_captcha: boolean;
  product: 'bind';
  width: string;
};

declare global {
  interface Window {
    initGeetest?: (
      options: GeetestOptions,
      ready: (instance: GeetestInstance) => void,
    ) => void;
  }
}
let scriptPromise: Promise<void> | null = null;

function loadGeetest() {
  if (window.initGeetest) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://static.maoercdn.com/assets/third_party/gt.js';
    script.async = true;
    script.onload = () => window.initGeetest ? resolve() : reject(new Error('猫耳滑块没有加载成功'));
    script.onerror = () => reject(new Error('猫耳滑块没有加载成功，请检查网络后重试'));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

export async function verifyMissevanCaptcha(options: {
  gt: string;
  challenge: string;
  offline: boolean;
}) {
  await loadGeetest();
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    window.initGeetest?.({ ...options, new_captcha: true, product: 'bind', width: '100%' }, captcha => {
      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        callback();
        captcha.destroy?.();
      };
      captcha.onSuccess(() => {
        const value = captcha.getValidate();
        if (!value) {
          finish(() => reject(new Error('滑块验证没有完成，请重试')));
          return;
        }
        finish(() => resolve(
          `geetest|${value.geetest_challenge}|${value.geetest_validate}|${value.geetest_seccode}`
        ));
      });
      captcha.onError(() => finish(() => reject(new Error('猫耳滑块验证失败，请重试'))));
      captcha.onClose(() => finish(() => reject(new Error('已取消滑块验证'))));
      captcha.verify();
    });
  });
}
