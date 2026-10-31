#import <Cocoa/Cocoa.h>

// Local development fixture; observes only this window, never global input.
static NSInteger clicks = 0;
static NSMutableArray *keys;
static void persist(void) {
    NSDictionary *state = @{ @"time": [NSISO8601DateFormatter.new stringFromDate:NSDate.date], @"clicks": @(clicks), @"keyCodes": keys };
    NSData *data = [NSJSONSerialization dataWithJSONObject:state options:NSJSONWritingPrettyPrinted error:nil];
    [data writeToFile:@"/tmp/pixelstreet-underlay.json" atomically:YES];
}
@interface ProbeKeys : NSTextView @end
@implementation ProbeKeys
- (void)keyDown:(NSEvent *)event {
    [keys addObject:@(event.keyCode)]; persist();
    if (event.keyCode == 48) [self insertText:@"\t" replacementRange:NSMakeRange(NSNotFound, 0)];
    else [super keyDown:event];
}
@end
@interface ProbeDelegate : NSObject <NSApplicationDelegate>
@property NSWindow *window;
@property NSButton *button;
@end
@implementation ProbeDelegate
- (void)applicationDidFinishLaunching:(NSNotification *)note {
    NSRect area = NSScreen.screens.firstObject.visibleFrame;
    self.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(area.origin.x+30,area.origin.y,1100,420) styleMask:(NSWindowStyleMaskTitled|NSWindowStyleMaskClosable|NSWindowStyleMaskMiniaturizable) backing:NSBackingStoreBuffered defer:NO];
    self.window.title = @"PixelStreet Native Underlay · Local input probe";
    self.window.backgroundColor = [NSColor colorWithCalibratedRed:.22 green:.25 blue:.32 alpha:1];
    NSTextField *label = [NSTextField labelWithString:@"LOCAL NATIVE PROBE — W A S D, Tab; bottom target tests empty-pixel click-through"];
    label.textColor=NSColor.whiteColor; label.frame=NSMakeRect(28,340,1040,40);
    NSScrollView *clip = [[NSScrollView alloc] initWithFrame:NSMakeRect(28,130,800,160)];
    ProbeKeys *field = [[ProbeKeys alloc] initWithFrame:NSMakeRect(0,0,800,160)];
    field.verticallyResizable=NO; field.horizontallyResizable=NO;
    field.font=[NSFont monospacedSystemFontOfSize:20 weight:NSFontWeightRegular]; field.backgroundColor=[NSColor colorWithCalibratedWhite:.12 alpha:1]; field.textColor=NSColor.whiteColor;
    self.button=[NSButton buttonWithTitle:@"Click-through target · 0" target:self action:@selector(hit:)]; self.button.frame=NSMakeRect(28,35,310,42);
    clip.documentView=field;
    [self.window.contentView addSubview:label]; [self.window.contentView addSubview:clip]; [self.window.contentView addSubview:self.button];
    [self.window makeKeyAndOrderFront:nil]; [self.window makeFirstResponder:field]; [NSApp activateIgnoringOtherApps:YES]; persist();
}
- (void)hit:(id)sender { clicks++; self.button.title=[NSString stringWithFormat:@"Click-through target · %ld",(long)clicks]; persist(); }
- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender { return YES; }
@end
int main(void) { @autoreleasepool { keys=NSMutableArray.new; NSApplication *app=NSApplication.sharedApplication; ProbeDelegate *delegate=ProbeDelegate.new; [app setActivationPolicy:NSApplicationActivationPolicyRegular]; app.delegate=delegate; [app run]; } return 0; }
