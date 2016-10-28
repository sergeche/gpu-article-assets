# GPU Animations: doing it right

I think everyone already know that modern web browsers are using GPU to render some page parts, especially during animations. For example, a CSS animation of `transform` property looks much smoother than one of `left/top` properties. But if ask “how to get smooth animations on GPU?” you’ll hear something like “use `transform: translateZ(0)` or `will-change: transform`” in most cases. These properties became something like `zoom: 1` for IE6 (if you know what I’m talking about ;) in terms of preparing animation for GPU, or *compositing*, as browser vendors prefer to call it.

But sometimes animations that worked nice and smooth in simple demos, runs very slow on real web-sites, introduces visual artifacts or even crash browser. Why is it happens? How to fix it? Let’s try to understand this article.

## One big disclaimer

The most important thing I’d like to tell you before we dive deep into GPU compositing: **it’s a one giant hack**. You won’t find anything (at least for now) in [W3C](https://www.w3.org) specs about how compositing works, how to explicitly put element on compositing layer or even compositing itself. It’s just an optimization that browser applies to perform some specific tasks and every browser vendor does it on it’s own way. Everything you’ll learn from this article is not an official explanation of how things works but a result of my experiments stuffed with common sense and knowledge of how different browser sub-systems work. Something might be just wrong, something could change over time — you have been warned!

## How compositing works

To prepare you page for GPU animations properly, it’s very important to clearly understand how stuff works in browser, not just follow some random advices found in the internet or this article.

Let’s say we have a page with `A` and `B` elements, each with `position: absolute` and different `z-index`. Browser will paint it on CPU, then send resulting image GPU, which will display it on screen afterwards.

```html
<style>
#a, #b {
	position: absolute;
}

#a {
	left: 30px;
	top: 30px;
	z-index: 2;
}

#b {
	z-index: 1;
}
</style>
<div id="#a">A</div>
<div id="#b">B</div>
```

<iframe src="https://sergeche.github.io/gpu-article-assets/examples/example1.html" height="300" frameborder="no" allowtransparency="true" style="width: 100%;"></iframe>

We decided to animate `A` element movement via `left` property via CSS Animations:

```html
<style>
#a, #b {
	position: absolute;
}

#a {
	left: 10px;
	top: 10px;
	z-index: 2;
	animation: move 1s linear;
}

#b {
	left: 50px;
	top: 50px;
	z-index: 1;
}

@keyframes move {
	from { left: 30px; }
	to   { left: 100px; }
}
</style>
<div id="#a">A</div>
<div id="#b">B</div>
```

<iframe src="https://sergeche.github.io/gpu-article-assets/examples/example1.html.a:anim-left" height="300" frameborder="no" allowtransparency="true" style="width: 100%;"></iframe>

In this case for every animation frame browser have to recalculate elements’ geometry (reflow), render image of a new page state (repaint) then send it again to GPU to display on screen. We know that repaint is a very performance-costly but every modern browser is smart enough to incrementally repaint changed page area only, not entire page. While browsers can repaint very fast in most cases, this animation still lacks smoothness.

Reflow and repaint—even incremental—of entire page on each animation step: sounds really slow, especially for large and complex layouts. *It would be much more effective just to paint two separate images: one for `A` element and one for entire page without `A` element, and then simply offset those images relative to each other*. In other words, it’s faster to *compose* cached elements’ images. And this is exactly where GPU shines: it’s able to compose images very fast with *subpixel precision* which adds sexy smoothness to animations.

To be able to apply compositing optimization, browser need to ensure that animated CSS properties:

1. does not affects document flow;
2. does not depends on document flow;
3. does not affect repaint.

It seems like `top` and `left` properties together with `position: absolute/fixed` doesn’t depend on element environment but it’s not. For example, a `left` property may receive a percent value, which depends on size of `.offsetParent`, as well as `em`, `vh` etc. units which also depends on environment. So namely `transform` and `opacity` CSS properties are exactly meet conditions above.

Let’s animate `transform` instead of `left` in our example:

```html
<style>
#a, #b {
	position: absolute;
}

#a {
	left: 10px;
	top: 10px;
	z-index: 2;
	animation: move 1s linear;
}

#b {
	left: 50px;
	top: 50px;
	z-index: 1;
}

@keyframes move {
	from { transform: translateX(0); }
	to   { left: translateX(70px); }
}
</style>
<div id="#a">A</div>
<div id="#b">B</div>
```

Take a look at the code. We described our animation declaratively: it’s start position, end position, duration etc. It tells browser ahead which CSS properties will be updated. Since it found out that none of them would cause reflow/repaint, it can apply a compositing optimization: paint two images as *compositing layers* and send them to GPU.

<iframe src="https://sergeche.github.io/gpu-article-assets/examples/example2.html#ru:.a:anim-translate" height="300" frameborder="no" allowtransparency="true" style="width: 100%;"></iframe>

Pros of such optimization:

* Very smooth animation with subpixel precision runs on a unit specially optimized for graphics tasks. And it runs really fast.
* Animation is no longer bound to CPU: even if you run a very intensive JS task, animation still runs fast.

Everything seems pretty clear and easy, right? What kind of problems we could have here? Let’s see how this optimization actually works.

---

It might be a surprise for some of you, but GPU is a *separate computer*. That’s right, an essential part of every modern device is actually a standalone unit with its own processors, memory and data processing concepts. And browser, as every other app or game, have to talk with GPU as with external device.

To better understand how it works, just think of AJAX. For example, you want to register a user with data he entered in a web form. You can’t tell a remote server “hey, just take data from these input fields and that JS variable and save them into database”. A remote server doesn’t have access to user browser’s memory. Instead, you collect required data from page into a payload with simple data format that can be easily parsed (like JSON) and send it to remote server.

Something very similar happens during compositing. Since GPU is like a remote server, browser has to create a payload first and then send it to device. Yes, GPU isn’t thousands miles away from CPU, it’s just right there, but if 2 seconds required for remote server request/response looks acceptable in many cases, extra 3–5 milliseconds for GPU data transfer will result in janky animations.

How does GPU payload looks like? In most cases it’s *layer images* and additional instructions like layer size, offset, animation params etc. Here’s how *roughly* the GPU payload making and data transfer looks like:

* Paint each compositing layer into separate image (repaint).
* Prepare layer data (size, offset, opacity etc.).
* Prepare shaders for animation (if one is used).
* Send data to GPU.

As you can see, every time you add magical `transform: translateZ(0)` or `will-change: transform` to element, you actually start the vary same process. You already know that repaint is very performance-costly, but it this case it works even slower: in most cases browser is unable to apply incremental repaint. It has to paint area that was previously covered by newly created composite layer:

<iframe src="https://sergeche.github.io/gpu-article-assets/examples/before-after-compositing.html" height="270" frameborder="no" allowtransparency="true" style="width: 100%;"></iframe>

## Implicit compositing

Let’s get back to our example with `A` and `B` elements. We animated `A` element before, which is on top of every other element on page. This resulted in two composite layers: one with `A` element and one with `B` and page background.

And now let’s animate `B` element instead...

<iframe src="https://sergeche.github.io/gpu-article-assets/examples/example3.html#.b:anim-translate" height="300" frameborder="no" allowtransparency="true" style="width: 100%;"></iframe>

...and we have a logical problem. Element `B` should be on a separate compositing layer, the final page image for screen should be composed on GPU. But `A` element should appear on top of element `B` and we didn’t tell anything to `A` that could promote it to it’s own layer.

Remember **One Big Disclaimer**: CSS specs doesn‘t have anything about special GPU-compositing mode, it’s just an optimization that browser applies internally. We *have* to have `A` appear on top of `B` in that order defined with `z-index`. What browser should do?

Exactly! It will forcibly create a new compositing layer for element `A`. And add another heavy repaint, of course:

<iframe src="https://sergeche.github.io/gpu-article-assets/examples/example4.html#.b:anim-translate" height="300" frameborder="no" allowtransparency="true" style="width: 100%;"></iframe>

> It’s called *implicit compositing*: one or more non-composite elements that should appear above composite element by stacking order are also promoted to composite layers, e.g. painted into separate image which is then sent to GPU.

You’ll stumble upon implicit composing much more often than you think: browser promotes element to compositing layer by many reasons. Here are just some of them:

* 3D transform: `translate3d`, `translateZ` etc.
* `<video>`, `<canvas>`, `<iframe>` elements.
* Animation of `transform` and `opacity` via `Element.animate()`.
* Animation of `transform` and `opacity` via СSS Transitions and Animations.
* `position: fixed`.
* [`will-change`](https://www.w3.org/TR/css-will-change-1/).
* [`backdrop-filter`](https://drafts.fxtf.org/filters/#FilterProperty).

More reasons are described in [CompositingReasons.h](https://cs.chromium.org/chromium/src/third_party/WebKit/Source/platform/graphics/CompositingReasons.h?q=file:CompositingReasons.h) file of Chromium project.

It seems like the main problem of GPU animations are unexpected heavy repaints. But it’s not. This bigger problem is...

## Memory consumption

Another gentle reminder that GPU is a separate computer. It’s required not just send rendered layer images to GPU, but to *store* them as well for later re-use in animations.

How much memory does a single composite layer takes? Let’s take a simple example. Try to guess how much memory is required to store a 320×240 rectangle, filled with solid `#ff0000` color.

<iframe src="https://sergeche.github.io/gpu-article-assets/examples/rect.html" height="270" frameborder="no" allowtransparency="true" style="width: 100%;"></iframe>

In most cases web-developers will think something like “hm, it’s a solid color image... I’ll save it as PNG and check it’s size, should be less than 1 KB”. And they’re absolutely right: the size of this image in PNG is 104 bytes.

But the problem is that PNG, as well as JPEG, GIF etc., are used to store and transfer image data. In order to draw such image on screen, a computer has to unpack it from given image format and then **represent as array of pixels**. Thus, our sample image will take *320×240×3 = 230 400 bytes* of computer memory. E.g. we multiply image width by its height to get a number of pixels in image. Then we multiply it by 3 since every pixel is described by three bytes: RGB. If the image contains transparent areas, we’ll multiply it by 4 since additional byte is required to describe transparency (RGBA): *320×240×4 = 307 200 bytes*.

Browser *always* paints compositing layers as RGBA images: seems like there’s no easy way to effectively determine whether element contains transparent areas.

Let’s take a more typical example: a carousel of 10 photos with 800×600 size each. You decided to implement a smooth images swap on user interaction, like dragging, so you add `will-change: transform` for every image. This will promote images to composite layers ahead-of-time so swapping transition begin immediately right after user interaction. Now, calculate how much *additional* memory it’s required just to display such carousel: 800×600×4 × 10 ≈ **19 MB**.

19 MB of additional memory is required for rendering of a single control! Assuming that modern web-developers are tend to create web-sites as SPA with lots of animated controls, parallax effects, retina images and other visual stuff, additional 100–200 MB per page is just a beginning. Mix it with implicit compositing (admit it, you haven’t even thought about it before, didn’t you? :) and we’ll end up with a page filling all available memory on device.

Moreover, in many cases this memory is just wasted to display the very same result:

<iframe src="https://sergeche.github.io/gpu-article-assets/examples/example5.html#ru" height="620" frameborder="no" allowtransparency="true" style="width: 100%;"></iframe>

It might not be an issue for desktop clients but really hurts mobile users. First, most modern devices are using high-density screens: multiply composite layer images weight by 4—9. Second, mobile devices doesn’t has as much memory as desktops. For example, a not-so-old-yet iPhone 6 ships with 1GB of shared (e.g. used for both RAM and VRAM) memory. Considering that at least one third of this memory is used by OS and background processes, another third by browser and current page (a best case for highly-optimized pages without tons of frameworks), you’ll have about 200—300 MB for GPU effects at most. Note that iPhone 6 is pretty expensive high-end device, more affordable ones contains much less memory on-board.

You may ask: *is it possible to store PNG images in GPU memory to reduce memory footprint?* Yes, technically it’s quite possible, the only problem is that GPU [draws screen pixel-by-pixel](http://www.html5rocks.com/en/tutorials/webgl/shaders/). Which means it has to decode entire PNG image for every pixel again and again. I doubt that animation in this case will be faster that 1 fps.

It’s worth nothing that there are GPU-specific [image compression formats](https://en.wikipedia.org/wiki/Texture_compression) but they are not even close to PNG or JPEG in terms of compression ratio and their usage is limited by hardware support.

## Pros and cons

Now, after we learned some basics of GPU animations, let’s sum-up all the pros and cons of using them.

### Pros

* A very fast and smooth animations at 60 fps.
* A properly crafted animations works in separate thread and is not blocked by heavy JS calculations.
* “Cheap” 3D transforms.

### Cons

* Additional repaint is required to promote element to a composite layer. Sometimes this repaint can be very slow (e.g. full layer repaint instead of incremental).
* Painted layer should be transferred to GPU. Depending on amount and size of these layers, the transfer can be very slow too. This may lead to element “flickering” on low- and mid-end devices.
* *Every composite layer consumes additional memory.* Memory is a very precious and limited resource on mobile devices. **Excessive memory use may crash browser!**
* Implicit compositing: if you don’t consider it, chances on slow repaint, extra memory usage and browser crash are very high.
* Visual artifacts: text rendering in Safari, disappeared or distorted page content in some cases.

As you can see, despite very useful and unique features, GPU animations has some very nasty issues that should be worried about. The most important ones are repaint and excessive memory use so all optimization techniques below will aim on very these problems.

## Browser setup

Before we start with optimization tips, it’s very important to learn about tools that will help you to examine composite layers on page as well as provide clear feedback about optimization efficiency.

### Safari

Safari’s Web Inspector has awesome Layers sidebar that displays all child’s composite layers and it’s memory consumption, as well as *compositing reason*. To see this sidebar:

1. In Safari, open Web Inspector with ⌘⌥I. If it doesn’t work, open Preferences > Advanced, turn on *Show Develop Menu in menu bar* option and try again.
2. When Web Inspector opened, pick Elements tab and select Layers in right sidebar.
3. Now, when you click on DOM nodes of main Elements’ pane, you’ll see a layer info for selected element (if it uses compositing) and all descendant composite layers.
4. Click on descendant layer to see its *compositing reason*: it tells you why browser decided to move this element to its own compositing layer.

![Safari with Web Inspector](https://sergeche.github.io/gpu-article-assets/images/safari@2x.png)

### Google Chrome

Chrome’s DevTools also was a similar panel, but you have to enable a special flag first:

1. In Chrome, go to `chrome://flags/#enable-devtools-experiments` enable **Developer Tools experiments** flag.
2. Open DevTools with ⌘⌥I (Mac) or Ctrl-Shift-I (PC), then click on ![DevTools settings icon](https://sergeche.github.io/gpu-article-assets/images/devtools-icon@2x.png) icon in upper right corner and pick Settings menu item.
3. Go to Experiments pane and enable Layers panel.
4. Re-open DevTools: you should see the Layers panel.

![Chrome with DevTools](https://sergeche.github.io/gpu-article-assets/images/chrome@2x.png)

This panel displays all active compositing layers of current page as a tree. If you pick a layer, you’ll see its info like size, memory consumption, repaint count and compositing reason.

## Optimization tips

After we set-up our environment, we can start with compositing layer optimization. We’ve already identified two main problems with compositing: extra repaints, which causes data transfer to GPU as well, and extra memory consumption. So all optimization tips below will focus on very these problems.

### Avoid implicit compositing

The most simple, obvious yet very important tip. Let me remind you that all non-compositing DOM elements above one with explicit compositing reason (`position: fixed`, video, CSS animation etc.) will be forcibly  promoted to their own layers just for correct final image composition on GPU. On mobile devices, it may cause a very slow animation start.

Let’s take a simple example:

<iframe height="305" scrolling="no" src="https://codepen.io/sergeche/embed/jrZZgL/?height=305&theme-id=light&default-tab=result&embed-version=2" frameborder="no" allowtransparency="true" allowfullscreen="true" style="width: 100%;"></iframe>

There’s `A` element that should be animated upon user interaction. If you take look at this page via Layers panel, you’ll see that there’s no extra layers. But right after clicking on the Play button you’ll see a few more layers, which will be removed right after animation ends. If you look at this process via Timeline panel, you’ll see that animation start and end are accompanied with repaints of large areas:

![Chrome timeline](https://sergeche.github.io/gpu-article-assets/images/chrome-timeline@2x.png)

Here’s what browser did, step-by-step:

1. Right after page load, browser didn’t found any reasons for compositing so it picked the most optimal strategy: paint whole page content on a single background layer.
2. After clicking on Play button, we’ve explicitly added compositing to element `A`: a transition of `transform` property. But browser determined that element `A` in *below* element `B` in stacking order so it promoted `B` to its own compositing layer too (implicit compositing).
3. Compositing layer promotion always causes repaint: browser has to create a new texture for element itself and remove it from previous layer.
4. New layer images must be transferred to GPU for final image composition that user will see on screen. *Depending on layers amount, texture size and content complexity, repaint and data transfer could take significant time to perform.* That is why sometimes you can see element “flickering” right on animation start or end.
5. Right after animation ends, we remove compositing reason from `A` element. Once again browser determined that it’s not necessary to waste resources on compositing so it falls back to most optimal strategy: keep whole page content on a single layer. Which means it has to paint `A` and `B` back on background layer (another repaint) and send updated texture to GPU. Same as in `4.`, this could cause “flickering”.

To get rid of implicit compositing issues and reduce visual artifacts, I recommend you the following:

* Try to keep animated objects as high as possible by `z-index`. Ideally, these elements should be direct children of `<body>` elements. Of course it’s not always possible due to nature of your markup when element is nested deep inside DOM tree and depends on normal flow. In such cases you could clone element to animate and put it inside `<body>` for animation only.
* You can give browser a hint that you’re going to use compositing with [`will-change`](https://developer.mozilla.org/docs/Web/CSS/will-change) CSS property. With this property set on element, browser will (but not always!) promote it to compositing layer in advance so animations can start and stop smoothly. But it’s very important to not misuse this property: otherwise you’ll end up with a tremendous increase in memory consumption.

### Animate `transform` and `opacity` properties only
