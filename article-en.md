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
