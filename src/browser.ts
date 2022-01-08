import { default as puppeteer, Browser, Protocol } from "puppeteer";

/*
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.setCookie(...cookies);
  await page.close();
*/

export const getLoginCookies = async (url: string) => {
  let latestCookies: Protocol.Network.Cookie[] = [];
  try {
    const browser = await puppeteer.launch({
      headless: false,
      defaultViewport: null,
      args: ["--app=https://www.google.com"],
    });
    const page = (await browser.pages())[0];
    await page.goto(url);
    console.info("Close the window after you have logged in.");
    browser.on("targetchanged", async () => {
      latestCookies = await page.cookies();
    });
    await new Promise((res) => browser.on("disconnected", res));
  } catch (e) {
    console.warn("Exception while getting login cookies:", e);
  }
  return latestCookies;
};

const fetchPlaylistItemsBrowser = async (
  browser: Browser,
  startURL: string
) => {
  const page = await browser.newPage();
  await page.goto(startURL);

  let items: string[] = [];
  let continuing = true;
  while (continuing) {
    const selected = Array.from(
      await page.$$(".main-inner-col .item-inner-col a:not(.add-to-fav)")
    );
    const pageItems: string[] = await Promise.all(
      selected.map(async (item) => {
        const hrefProperty = await item.getProperty("href");
        return await hrefProperty?.jsonValue();
      })
    );
    console.log(pageItems);
    items = items.concat(pageItems);

    const nextPageElem = await page.$('a[rel="next"]');
    const nextPageProp = await nextPageElem?.getProperty("href");
    const nextPageLink = (await nextPageProp?.jsonValue()) as string;
    if (!nextPageLink) {
      continuing = false;
    } else {
      await page.goto(nextPageLink);
    }
  }
  return items;
};

const fetchDownloadURLsBrowser = async (
  browser: Browser,
  itemURLs: string[]
) => {
  const page = await browser.newPage();
  const downloadURLs: string[] = [];
  for (const url of itemURLs) {
    await page.goto(url);
    const selected = await page.$('a[data-mb="download"]');
    const hrefProperty = await selected?.getProperty("href");
    const href = (await hrefProperty?.jsonValue()) as string;
    if (href !== undefined) {
      downloadURLs.push(href);
      console.log(href);
    }
  }
  return downloadURLs;
};
